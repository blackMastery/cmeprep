-- Money received. One row per PayPal ORDER we captured.
--
-- Written by both grant paths — app/api/paypal/orders/[orderId]/capture/route.ts
-- and app/api/paypal/webhook/route.ts — through recordCapturedPurchase() in
-- lib/subscriptions.ts, with the row primitives in lib/payments.ts and the pure
-- amount/refund arithmetic in lib/payments-core.ts.
--
-- Why this table exists: until now the only trace of an amount was
-- audit_logs.meta, written by grantPlanPurchase AFTER a successful grant, and
-- payment_events.payload, written only for webhook deliveries. The one case
-- that actually needs a record — money captured, grant failed, no webhook yet —
-- left nothing but a console.error. subscriptions.paypal_subscription_id holds
-- the ORDER id and doubles as the grant's idempotency key, but a subscription
-- is an ENTITLEMENT, not a receipt: it carries no amount, no capture id, and no
-- row at all when the grant fails.
--
-- Admin comp grants (app/admin/users/actions.ts) deliberately write NOTHING
-- here: no money moved, and a 0-cent row would land in every revenue sum.

create table payments (
  id uuid primary key default gen_random_uuid(),

  -- Nullable, and ON DELETE SET NULL rather than the NO ACTION that
  -- subscriptions.user_id uses — same reasoning as contact_messages.user_id in
  -- 20260803000001. Two reasons, both "never lose a capture": the webhook takes
  -- the buyer id from PayPal's custom_id, which is not guaranteed to still
  -- resolve, and an FK failure here would discard the exact row this table
  -- exists to keep. custom_id below preserves what PayPal echoed either way.
  user_id uuid references profiles on delete set null,

  -- The subscription this payment bought, or NULL when it bought nothing.
  --
  -- The FK points THIS way on purpose. A payment can exist without a
  -- subscription (unknown plan, unknown exam, insert failure); a paid
  -- subscription can never exist without a payment. subscriptions.payment_id
  -- would therefore be the column that cannot be written in precisely the
  -- failure case this table is being added for. `where subscription_id is null`
  -- IS the captured-but-never-granted report.
  --
  -- Deliberately NOT unique. One order maps to one subscription today, so it is
  -- unique in practice; a unique index would turn a future "one payment tops up
  -- an existing subscription" into an insert failure AFTER the money was taken.
  -- Nothing in this table may fail that way.
  subscription_id uuid references subscriptions on delete set null,

  -- plan_id/exam_id are written only AFTER they have been read back from their
  -- own tables (see recordPaymentGrant): the insert happens BEFORE anything is
  -- validated, so writing an unresolved id here would trip the FK and lose the
  -- row. When resolution fails these stay NULL and custom_id + grant_failure
  -- carry the intent.
  plan_id uuid references plans on delete set null,
  -- on delete restrict mirrors subscriptions.exam_id (20260726000001): an exam
  -- that has ever been sold stays undeletable, which is the correct posture for
  -- a financial record.
  exam_id uuid references exams on delete restrict,

  -- Name and price SNAPSHOT at capture time. plans.price_cents is mutable — the
  -- admin plan manager edits it — and a receipt must not be. plan_price_cents is
  -- also the "expected" side of the amount check that the capture route could
  -- previously only console.error about: `where amount_cents is distinct from
  -- plan_price_cents` now finds every under/overpayment, permanently.
  plan_name text,
  plan_price_cents int check (plan_price_cents >= 0),

  -- PayPal's ORDER id — the idempotency key, and the same value stored in
  -- subscriptions.paypal_subscription_id. UNIQUE so the capture route and the
  -- webhook racing on one order produce exactly one payment row, exactly like
  -- the grant. Also the upsert conflict target and the refund lookup key.
  paypal_order_id text not null unique,

  -- The CAPTURE id (one per order for this app's single-unit orders).
  -- NOT unique, on purpose: a unique violation must never be able to block
  -- recording money PayPal has already moved.
  paypal_capture_id text,

  -- The purchase unit's custom_id verbatim ("userId:planId:examId"). Redundant
  -- with the columns above when everything resolves, and the only lossless
  -- record when something does not. Not recoverable from payment_events: the
  -- capture route never writes an event row.
  custom_id text,

  -- What PayPal actually moved, in the currency PayPal actually reported —
  -- never the plan price.
  --
  -- NULLABLE on purpose. If a capture ever arrives without an amount the row
  -- still has to land; NOT NULL would force the write path to invent a number,
  -- and 0 cannot be the sentinel because 0 is a real amount. sum(amount_cents)
  -- ignores NULLs, and `count(*) filter (where amount_cents is null)` is the
  -- data-quality alarm. int cents assumes a 2-decimal currency; the app sells
  -- USD only (CURRENCY in lib/paypal.ts), and recording what PayPal sent makes
  -- a zero-decimal currency detectable rather than silently 100x wrong.
  amount_cents int check (amount_cents >= 0),
  currency text check (char_length(currency) = 3),

  -- Running total across possibly several PARTIAL refunds (PayPal allows N per
  -- capture). A total, not a log: nextRefundedCents() in lib/payments-core.ts
  -- takes the monotonic max of our figure and PayPal's cumulative
  -- seller_payable_breakdown.total_refunded_amount, so a redelivered or
  -- replayed refund webhook cannot double-count. The cross-column check below
  -- is a backstop only — nextRefundedCents clamps to amount_cents first, so a
  -- surprising refund amount can never throw inside the webhook handler and
  -- strand the event unprocessed.
  refunded_cents int not null default 0 check (refunded_cents >= 0),

  -- text + check, not an enum: no migration here has ever created a type, and
  -- `alter type ... add value` cannot run inside a transaction, which is exactly
  -- the wrong property for a status set that will grow. No 'pending' — nothing
  -- produces one yet (eCheck/pending captures are in payments-backlog.md), and
  -- an unreachable status invites code that pretends to handle it.
  status text not null default 'captured'
    check (status in ('captured', 'partially_refunded', 'refunded', 'denied', 'reversed')),

  -- Which code path wrote the row. No default: every caller states it, and
  -- 'backfill' marks the rows reconstructed at the bottom of this file, whose
  -- plan_price_cents is unknowable and therefore NULL.
  source text not null
    check (source in ('capture_route', 'webhook_capture', 'webhook_approved',
                      'reconcile', 'backfill')),

  -- Why the grant did not happen. NON-NULL means money with nothing behind it.
  -- `subscription_id is null` is the index-backed version of the same question;
  -- this column says WHICH of the ways it went wrong, so support does not have
  -- to reconstruct it from logs.
  grant_failure text
    check (grant_failure in ('unknown_user', 'unknown_plan', 'no_duration',
                             'unknown_exam', 'insert_failed')),

  -- PayPal's capture create_time when it sent one, else insert time. Revenue is
  -- reported on when the money moved; on the webhook reconciliation path that
  -- can be hours before this row existed.
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),

  -- Cross-column, so it cannot live inline.
  constraint payments_refund_within_amount
    check (amount_cents is null or refunded_cents <= amount_cents)
);

-- /profile receipts and the admin user page: "this buyer's payments, newest
-- first".
create index payments_user_idx on payments (user_id, captured_at desc);

-- THE reconciliation report, swept by lib/reconcile.ts: captures that never
-- became a subscription. Partial, because the answer is expected to be empty
-- and the index should cost nothing while it is.
create index payments_unclaimed_idx on payments (captured_at desc)
  where subscription_id is null;

-- Refund webhooks resolve by capture id when the payload carries no order id,
-- and support pastes capture ids straight out of the PayPal dashboard.
create index payments_capture_idx on payments (paypal_capture_id)
  where paypal_capture_id is not null;

-- No index for revenue-by-period or revenue-by-exam, deliberately: those are
-- full-table aggregates over a table that grows one row per sale, and Postgres
-- will scan it either way for years. Add (captured_at) or (exam_id, captured_at)
-- when a report is actually slow, not before.

comment on column payments.subscription_id is
  'Subscription this payment bought; NULL = captured with no grant (see grant_failure).';
comment on column payments.exam_id is
  'Exam bought. NULL + grant_failure NULL = grandfathered all-access; NULL + grant_failure set = unresolved, see custom_id.';
comment on column payments.refunded_cents is
  'Running total refunded across partial refunds; monotonic, so replayed refund webhooks cannot double-count. status is derived from it.';

-- The column name has misled every reader of the webhook route: these are
-- one-time Orders v2 captures, not PayPal Subscriptions.
comment on column subscriptions.paypal_subscription_id is
  'PayPal ORDER id for a one-time capture, NOT a PayPal subscription id. The money for it is payments.paypal_order_id.';

-- ── RLS ─────────────────────────────────────────────────────
alter table payments enable row level security;

-- Buyers may read their OWN payments. This is their money, it mirrors
-- subscriptions_select_own (20260718000003), and it is what a receipts list on
-- /profile will need without another migration. Unlike contact_messages, a
-- payment row holds nothing belonging to a third party.
--
-- The triage columns (custom_id, plan_price_cents, source, grant_failure,
-- updated_at) are held back at the COLUMN level in the grant below rather than
-- by splitting the table or adding a view — the same mechanism as
-- `grant update (full_name) on profiles` in 20260718000004. plan_price_cents in
-- particular is an internal "what we expected" figure; showing a buyer a
-- mismatch invites a dispute about a payment PayPal already settled.
--
-- Consequence to remember: an RLS-client `select *` on payments fails with
-- "permission denied for column". Buyer-facing reads must name columns. Admin
-- surfaces are unaffected — every admin read goes through the service-role
-- client, which bypasses both RLS and column privileges.
create policy payments_select_own on payments
  for select using (user_id = auth.uid() or public.is_admin());

-- No insert/update/delete policy for anyone. Every write is service-role, from
-- the PayPal routes and the reconciliation sweep. A buyer must never be able to
-- mint a receipt.

-- 20260718000004's blanket service_role grant only covered tables existing
-- then, so this is explicit — same as 20260721000001/2 and 20260803000001.
grant select, insert, update, delete on public.payments to service_role;
grant select (id, user_id, subscription_id, plan_id, plan_name, exam_id,
              paypal_order_id, paypal_capture_id, amount_cents, currency,
              refunded_cents, status, captured_at, created_at)
  on public.payments to authenticated;
revoke all on public.payments from anon;

-- ── Backfill from payment_events ────────────────────────────
-- Reconstructed from PAYMENT.CAPTURE.COMPLETED payloads ONLY. That payload is
-- PayPal's own record of the money, so amount, currency and capture time are
-- real rather than inferred.
--
-- Deliberately NOT backfilled from subscriptions ⋈ plans: plans.price_cents is
-- mutable, so that join would stamp today's price onto last quarter's sale and
-- make every revenue number quietly wrong. A short, correct history beats a
-- long, fictional one. Subscriptions with no COMPLETED event therefore get no
-- payment row; list them with
--
--   select s.* from subscriptions s
--   left join payments p on p.paypal_order_id = s.paypal_subscription_id
--   where s.paypal_subscription_id is not null and p.id is null;
--
-- plan_price_cents stays NULL on these rows for the same reason.
--
-- Idempotent (`on conflict do nothing`) and a no-op on an empty payment_events,
-- so it is safe on a fresh database and across repeated `supabase db reset`.

with captures as materialized (
  -- `materialized` pins the regex guard BEFORE the ::uuid casts in the outer
  -- query. Without it the planner may inline the CTE, evaluate a cast against a
  -- malformed custom_id and abort the whole migration.
  select distinct on (pe.payload #>> '{resource,supplementary_data,related_ids,order_id}')
    pe.payload #>> '{resource,supplementary_data,related_ids,order_id}' as order_id,
    pe.payload #>> '{resource,id}'                                      as capture_id,
    pe.payload #>> '{resource,custom_id}'                               as custom_id,
    pe.payload #>> '{resource,amount,value}'                            as amount_value,
    pe.payload #>> '{resource,amount,currency_code}'                    as currency,
    coalesce((pe.payload #>> '{resource,create_time}')::timestamptz, pe.created_at)
                                                                        as captured_at
  from payment_events pe
  where pe.type = 'PAYMENT.CAPTURE.COMPLETED'
    and pe.payload #>> '{resource,supplementary_data,related_ids,order_id}' is not null
    and pe.payload #>> '{resource,custom_id}' ~
        '^[0-9a-fA-F-]{36}:[0-9a-fA-F-]{36}(:[0-9a-fA-F-]{36})?$'
    and coalesce(pe.payload #>> '{resource,amount,value}', '') ~ '^[0-9]+(\.[0-9]{1,2})?$'
  order by
    pe.payload #>> '{resource,supplementary_data,related_ids,order_id}',
    pe.created_at asc
)
insert into payments (
  user_id, subscription_id, plan_id, plan_name, plan_price_cents, exam_id,
  paypal_order_id, paypal_capture_id, custom_id,
  amount_cents, currency, status, source, captured_at, created_at
)
select
  pr.id,
  s.id,
  pl.id,
  coalesce(s.plan, pl.name),
  null,                                    -- historical price: unknowable
  coalesce(s.exam_id, ex.id),
  c.order_id,
  c.capture_id,
  c.custom_id,
  round(c.amount_value::numeric * 100)::int,
  c.currency,
  'captured',                              -- refunds folded in by the pass below
  'backfill',
  c.captured_at,
  c.captured_at
from captures c
left join profiles pr on pr.id = split_part(c.custom_id, ':', 1)::uuid
left join plans    pl on pl.id = split_part(c.custom_id, ':', 2)::uuid
left join exams    ex on ex.id = nullif(split_part(c.custom_id, ':', 3), '')::uuid
left join subscriptions s on s.paypal_subscription_id = c.order_id
on conflict (paypal_order_id) do nothing;

-- Second pass: fold historical refunds into the running total, from the same
-- source of truth. PAYMENT.CAPTURE.DENIED needs no pass — a denied capture
-- never produced a COMPLETED event, so it has no row here to update.
with refunds as materialized (
  select
    pe.payload #>> '{resource,supplementary_data,related_ids,order_id}' as order_id,
    sum(round((pe.payload #>> '{resource,amount,value}')::numeric * 100)::int)
                                                                       as refunded_cents
  from payment_events pe
  where pe.type = 'PAYMENT.CAPTURE.REFUNDED'
    and pe.payload #>> '{resource,supplementary_data,related_ids,order_id}' is not null
    and coalesce(pe.payload #>> '{resource,amount,value}', '') ~ '^[0-9]+(\.[0-9]{1,2})?$'
  group by 1
)
update payments p
set refunded_cents = least(coalesce(p.amount_cents, r.refunded_cents), r.refunded_cents),
    status = case
               when p.amount_cents is not null and r.refunded_cents < p.amount_cents
                 then 'partially_refunded'
               else 'refunded'
             end,
    updated_at = now()
from refunds r
where p.paypal_order_id = r.order_id
  and p.source = 'backfill';
