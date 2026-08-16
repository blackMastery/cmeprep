# Payments — Deferred Work

What the PayPal integration does **not** do yet, and why each gap matters.

Three defects were closed on 2026-08-10 and are listed here only as context:
the `payments` table (money is recorded before the grant is attempted, so a
capture with no subscription behind it is queryable), the reconciliation sweep
(`/api/cron/reconcile`, scheduled from `pg_cron`), and amount-aware refunds (a
partial refund is recorded and leaves access alone). Everything below is
outstanding.

Ordered by how much the absence costs. Tiers 1–2 are money and support hours;
tiers 3–4 are revenue and hardening.

---

## 1. Operational blind spots

The sweep and the payment record now produce good data. Nothing reads it.

- [ ] **Alerting.** `paypal_amount_mismatch`, `payment.grant_failed`,
  `reconcile_event_replay_failed` and `payment.reconcile_failed` are
  `console.error` plus an `audit_logs` row with no reader. Sentry appears in
  `exam-app-development-plan.md` §9 and in `README.md` but is wired nowhere —
  no `@sentry/nextjs`, no `instrumentation.ts`, no `SENTRY_DSN`.
  **Done when:** a failed grant or a failed sweep raises an alert somebody
  receives without opening Supabase Studio.

- [x] **`/admin/payments`.** Built 2026-08-16 with the admin business
  dashboard: a filterable payments list (day / exam / status / unclaimed)
  plus ops alerts on `/admin` (unclaimed money, webhook backlog, stale
  sweep — the sweep now persists each run to `reconcile_runs`) and a nav
  badge. The amount-mismatch query below is the one view still unbuilt:
  ```sql
  select * from payments where subscription_id is null order by captured_at desc;
  select * from payments where amount_cents is distinct from plan_price_cents
    and plan_price_cents is not null;
  select * from payment_events where processed_at is null and replay_attempts >= 5;
  select * from audit_logs where action like 'payment.reconcile%' order by created_at desc;
  ```
  Plus a heartbeat check: the newest `payment.reconcile` row older than ~2h
  means the cron is dead. `net._http_response` (pg_net, ~6h retention) shows
  delivery failures.
  **Done when:** an admin can see unclaimed money, quarantined events and the
  sweep heartbeat without SQL.

- [ ] **Disputes.** `CUSTOMER.DISPUTE.CREATED` / `.RESOLVED` fall to the ignore
  branch in `dispatchPaypalEvent`. `PAYMENT.CAPTURE.REVERSED` is handled, so a
  *completed* chargeback revokes access — but the window between a dispute
  opening and resolving is invisible, which is exactly when evidence has to be
  submitted.
  **Done when:** an opened dispute is visible in the admin payments view before
  PayPal decides it.

---

## 2. What the buyer never receives

- [ ] **Receipts.** No purchase confirmation, no invoice, no downloadable
  receipt. There is no mail infrastructure at all beyond Supabase auth mail —
  see the note at the top of `20260803000001_contact_messages.sql`. Buyers get
  PayPal's own receipt and nothing from us, which also blocks anyone expensing
  this to a CME budget.
  **Done when:** a completed purchase sends a receipt carrying the plan, exam,
  amount and access-until date.

- [ ] **Purchase history.** `components/profile/subscription-card.tsx` shows
  active access per exam only. The `payments_select_own` policy and its column
  grants shipped with the payments table specifically so this is a UI-only
  change — but note an RLS-client `select *` will fail with "permission denied
  for column"; name the columns.
  **Done when:** a buyer can see every payment they have made, with dates and
  amounts, and prove they paid without emailing support.

- [ ] **Expiry emails.** `components/subscriptions/expiry-banners.tsx` warns
  in-app only, so a student who stops logging in just lapses. Cheapest revenue
  recovery available.
  **Done when:** access nearing its end triggers a reminder with a renew link.

- [ ] **Pending captures.** eCheck and review-held payments come back
  non-`COMPLETED`; the capture route returns `capture_failed` and nothing
  handles the later `PAYMENT.CAPTURE.PENDING` → `COMPLETED` transition. Those
  buyers pay and never get access. Deliberately excluded from the payments
  table's `status` check for now — nothing produces a `pending` row yet, and an
  unreachable status invites code that pretends to handle it. Needs: the status
  value, the webhook case, and a third sweep pass re-checking pending orders at
  PayPal (bounded to ~72h; orders expire).
  **Done when:** an eCheck buyer gets access when the funds settle, without
  support intervention.

---

## 3. Commercial surface

| Gap | Where it bites |
|---|---|
| PayPal only | No card checkout for buyers without a PayPal account. Smart Buttons support hosted card fields; not enabled. |
| USD only | `CURRENCY` is hardcoded in `lib/paypal.ts` and `plans.price_cents` is a single column. The audience (PLAB, USMLE) is largely non-US. |
| No discounts or bundles | No coupon model, and one exam per order — three exams is three separate PayPal flows with no multi-exam price. |
| No tax/VAT | No tax fields, no location-based collection, no tax line on any document. |
| Teams is marketing only | `app/(marketing)/teams/page.tsx` sells 90-seat org accounts, licence reassignment and invoice/PO billing. None of it exists — no org table, no seat model, no invoicing. Today that page is a contact form. |
| No recurring billing | These are one-time captures; the PayPal Subscriptions API from `exam-app-development-plan.md` Phase 7 was never used. Defensible, but it means no auto-renew and no predictable revenue. |

**Done when:** each row is either built or struck from the marketing copy that
promises it. The teams page is the urgent one — it currently advertises billing
that cannot be delivered.

---

## 4. Hardening

- [ ] **Rate limit `/api/paypal/orders`.** Any authenticated user can spam order
  creation, each call hitting PayPal. There is no app-level rate limiting
  anywhere in the repo.
- [ ] **`PayPal-Request-Id` on create-order.** A retried request currently mints
  a duplicate order.
- [ ] **Admin refund action.** `app/admin/users/actions.ts` can cancel a
  subscription, which only revokes access — refunding still means the PayPal
  dashboard plus a webhook round trip.
- [ ] **`sub_status = 'expired'` is decorative.** Nothing flips a lapsed row;
  every read compensates via `isEffectivelyActive`. Correct for entitlements,
  but the DB is not queryable for true status.
- [ ] **Stacked-refund period ends.** Refunding the *first* of two stacked
  purchases leaves the second row's `current_period_end` — which `stackBase`
  computed from the first — built on refunded money. Fixing it means recomputing
  a chain. Commented at `revokeSubscriptionForOrder` in `lib/paypal-events.ts`.
- [ ] **`payment_refunds` ledger.** `payments.refunded_cents` is a monotonic
  counter, which is idempotent whenever PayPal sends
  `seller_payable_breakdown.total_refunded_amount` and best-effort when it does
  not (see the comment on `nextRefundedCents`). A table keyed on the refund id
  would make the incremental path exact and answer "which refunds make up this
  total". Worth it only once partial refunds are routine.
- [ ] **Atomic event claiming.** The sweep claims a batch by incrementing
  `replay_attempts` right after selecting it, so two overlapping runs can waste
  one attempt on a row. Harmless at a 15-minute cadence. A tighter schedule
  wants a `security definer` RPC doing `select … for update skip locked` +
  `update … returning` in one statement — the only way to get `SKIP LOCKED`
  through PostgREST. Do **not** reach for `pg_try_advisory_lock`: session locks
  bind to a connection, PostgREST pools without session affinity, and
  `pg_advisory_xact_lock` releases at the end of the single-statement
  transaction.

---

## 5. Operator runbook

Setup, once per hosted environment — the sweep does nothing until both exist:

```sql
select vault.create_secret('https://www.cmeprep.me/api/cron/reconcile', 'reconcile_url');
select vault.create_secret('<same value as the CRON_SECRET env var>', 'reconcile_cron_secret');
```

The nightly analytics rollup (admin dashboard) needs one more; it reuses
`reconcile_cron_secret` as its bearer. After the first deploy, load history by
POSTing `{"mode":"backfill"}` to `/api/admin/analytics/rollup` (as an admin)
repeatedly until it reports `done: true`:

```sql
select vault.create_secret('https://www.cmeprep.me/api/cron/rollup', 'analytics_rollup_url');
```

Checks:

```sql
select * from cron.job where jobname in ('reconcile-payments', 'analytics-rollup');
select * from cron.job_run_details order by start_time desc limit 10;
select * from net._http_response order by created desc limit 5;   -- ~6h retention
select * from audit_logs where action = 'payment.reconcile' order by created_at desc limit 5;
select * from reconcile_runs order by ran_at desc limit 5;        -- same data, typed
select * from audit_logs where action = 'analytics.rollup' order by created_at desc limit 3;
select value from analytics_state where key = 'last_nightly';
```

Subscriptions that predate the payments table and so have no money row:

```sql
select s.* from subscriptions s
left join payments p on p.paypal_order_id = s.paypal_subscription_id
where s.paypal_subscription_id is not null and p.id is null;
```
