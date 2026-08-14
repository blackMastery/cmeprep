-- Org billing (SPEC.md §5): sellable org plans, the org grant path's
-- idempotency key, and the payments columns that let the reconcile sweep
-- treat org purchases with the same "money first, grant attached after"
-- discipline as personal ones.

-- ── plans: org products ─────────────────────────────────────
-- kind splits the two storefronts: personal checkout must never offer an org
-- plan and vice versa. text + check, not an enum, matching payments.status.
alter table plans add column kind text not null default 'personal'
  check (kind in ('personal', 'org'));

-- Seats the plan sells. Applied to orgs.seat_limit at grant time (only ever
-- raised automatically — lowering is a human decision in /admin).
alter table plans add column seat_limit int
  check (seat_limit is null or seat_limit > 0);

-- The Team plan from the marketing page: $1,200/year, up to 90 users.
-- Seeded here (fixed uuid, idempotent) so self-serve org checkout works
-- without a manual /admin step; price and copy stay editable in /admin/plans.
insert into plans
  (id, name, price_cents, period, description, features, duration_months,
   featured, is_active, position, kind, seat_limit)
values (
  '00000000-0000-0000-0000-00000000900f',
  'Team',
  120000,
  'per year',
  'One flat price for schools and companies getting a cohort exam-ready together.',
  array[
    'Up to 90 users',
    'Full access to every question bank and mock exams',
    'Shared analytics for program directors',
    'Private question banks',
    'Audit logs'
  ],
  12,
  true,
  true,
  100,
  'org',
  90
)
on conflict (id) do nothing;

-- ── org_subscriptions: PayPal idempotency ───────────────────
-- Unique on the ORDER id exactly like subscriptions.paypal_subscription_id:
-- the capture route and the webhook race deliberately, and the loser must
-- land on the winner's row.
alter table org_subscriptions add column paypal_order_id text unique;

-- ── payments: org purchases ─────────────────────────────────
-- org_subscription_id is the org twin of subscription_id: "granted" for an
-- org purchase = org_subscription_id set. The reconcile sweep's unclaimed
-- scan checks BOTH nulls, so each kind keeps its own definition of done.
alter table payments add column org_id uuid references orgs (id);
alter table payments add column org_subscription_id uuid
  references org_subscriptions (id);

comment on column payments.org_id is
  'Org bought for; null = personal purchase (or unresolved org, see custom_id).';
comment on column payments.org_subscription_id is
  'Org subscription this payment bought; the org-purchase side of "granted".';

-- 'unknown_org': an orgv1 custom_id whose org id no longer resolves.
alter table payments drop constraint payments_grant_failure_check;
alter table payments add constraint payments_grant_failure_check
  check (grant_failure in ('unknown_user', 'unknown_plan', 'no_duration',
                           'unknown_exam', 'unknown_org', 'insert_failed'));
