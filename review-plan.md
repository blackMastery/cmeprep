# Production readiness review — cmeqbank.com

## Context

cmeqbank.com is **live** with real users, all currently on the `trial` role, and
has **taken no payments yet**. This review ranks what stands between the app as
deployed today and a system that can safely take money and be operated.

Three parallel audits covered security/authz, operations/reliability, and
money-path correctness. Every finding below was verified against the code
directly, not taken from comments — this codebase has unusually confident
comments and several of them describe intent that the code does not deliver.

**The headline:** the *design* is strong — real server-authoritative pricing,
genuine idempotency, no IDOR, an answer key that does not leak on the intended
paths, and a reconciliation sweep most pre-launch products don't have. The gaps
are in three places: **the question bank is readable by anyone who registers**,
**every safety mechanism reports to a `console.error` nobody reads**, and **the
recovery machinery for payments has holes that only appear once money moves**.

Because no payments have been taken, the money-path defects are cheap to fix
now and there is no historical data to repair. That window closes on the first
sale.

---

## Ranked findings

Severity assumes the current state: live, trial users, no revenue yet.

### P0 — fix before taking a single payment

| # | Finding | Evidence | Why it's P0 |
|---|---|---|---|
| 1 | **Entire question bank readable by any logged-in user.** `select` on all columns of `questions` is granted to `authenticated`, and the policy admits every published row. Anyone who registers can `GET /rest/v1/questions?select=stem,explanation` with the publishable key and dump the product, answers-in-prose included. A second door: `bookmarks` INSERT is granted to clients, so a user can bookmark *any* question id and read stem+explanation back through the PostgREST embed. | `supabase/migrations/20260718000004_grants.sql:19-32`, `20260718000003_rls.sql:47-49`, `lib/bookmarks.ts:78-84` | Live **now** — the bank is scrapeable by any competitor today, and it is a straight paywall bypass the moment you sell. Entitlement is enforced only in app code; nothing in RLS ties questions to a subscription. |
| 2 | **Auth email deliverability is unverified and probably broken.** `[auth.email.smtp]` is commented out; `enable_confirmations = true` makes verification mandatory to log in; `email_sent = 2` per hour mirrors Supabase's default-SMTP posture. Supabase's built-in SMTP is capped at a handful of emails/hour and is explicitly not for production. | `supabase/config.toml:255,269,225` | Live **now**. If the hosted project has no custom SMTP, some fraction of your registrations already never receive a verification email and can never log in. The failure happens at Supabase's edge, so it produces **no log line in your app at all**. Verify today; ~10 minutes. |
| 3 | **Zero error reporting — the app cannot tell you when it fails.** No Sentry, no `instrumentation.ts`, no `onRequestError`, no log drain. Every failure path terminates in `console.error` or an `audit_logs` row. `audit_logs` has **no reader anywhere** — no `/admin/audit`, no query. | `package.json`, no `instrumentation*.ts`, `lib/admin/audit.ts:80-97` (writer only) | Every other finding inherits this. Amount mismatches, failed grants, refunds that can't be resolved, quarantined events, a dead cron — all invisible. The sweep even writes a heartbeat *specifically* so someone notices it stopped; nothing reads it. |
| 4 | **Capture route takes the money and writes nothing on two paths.** `!capture \|\| !parsed` → 502 and `parsed.userId !== user.id` → 403 both run *after* `capturePaypalOrder` has settled, and both return without any `recordCapture`. The webhook drops the unparseable-`custom_id` case for the same reason, so path A's money is recorded nowhere at all. | `app/api/paypal/orders/[orderId]/capture/route.ts:59-62`, `:66-68`; `lib/paypal-events.ts:91-93` | A settled capture with no `payments` row is money the sweep cannot find, because the sweep queries `payments`. The 403 is correct security; the missing write is the bug. |
| 5 | **Reconciliation Pass B starves permanently.** The unclaimed-payments scan has no attempt counter and no quarantine, and `repairPayment` returns `false` *forever* for `unknown_plan`/`unknown_user`/`no_duration`. 50 unrepairable rows at the head of the queue and **every subsequent buyer who needs repair is never repaired**. Pass A has exactly this guard; Pass B does not. Worse, it gives up on `!payment.plan_id` while `payments.custom_id` holds `userId:planId:examId` verbatim and `parsePurchaseCustomId` already exists. | `lib/reconcile.ts:163-174`, `:225-237`; cf. `lib/reconcile-core.ts:24` | This is the one mechanism built to catch "buyer paid, no access". It converts that into "buyer paid, no access, forever" — and the summary reports `failed: 50` on every run, so a new outage is indistinguishable from the old backlog. |
| 6 | **Verify the reconciliation cron is actually running.** The pg_cron job body is wrapped in `where exists (select 1 from vault.decrypted_secrets …)`. If the two Vault secrets were never created by hand, the job fires every 15 min, **succeeds, and does nothing**. `cron.job_run_details` shows success. | `supabase/migrations/20260810000002_payment_reconciliation.sql:60-78`; runbook at `payments-backlog.md:146-149` | Silent-off switch. If it has never fired, #5 is latent rather than active — and #4's self-heal doesn't exist. One SQL query to check. |

### P1 — fix before you scale content or headcount

| # | Finding | Evidence | Impact |
|---|---|---|---|
| 7 | **Question pool silently caps at 500.** Candidate selection is `.limit(500)` with **no `ORDER BY`** and no random sampling, then shuffled in JS. Once a subject set exceeds 500 published questions, students draw from the same arbitrary 500 forever and never see the rest. With multiple subjects, one subject can consume the whole cap, skewing a "mixed" paper. | `app/api/tests/route.ts:106-117` | Grows silently with your content. The marketing page advertises "UNLIMITED Questions" (`app/(marketing)/page.tsx:26-29`). Refund risk. |
| 8 | **No CI.** No `.github/`, no Dockerfile, no `vercel.json`. `lint` + `tsc --noEmit` + 16 vitest files exist and nothing enforces them. | — | A broken build reaches production. |
| 9 | **No `app/global-error.tsx`.** `app/error.tsx` exists (and its function is confusingly *named* `GlobalError`), but `error.tsx` cannot catch a throw from the root layout — which loads three Google fonts and constructs `new URL(SITE_URL)` at render. | `app/error.tsx:7`, `app/layout.tsx:13-38` | Root-layout failure = Next's unstyled default error page. Also: no per-segment `error.tsx` anywhere, so any server-component throw blows away the whole page including nav. |
| 10 | **Submit failure silently bounces the student back into the test.** The submit `catch` is empty and unconditionally routes to results; results calls `finalizeIfExpired` and redirects back to `/take` if still in progress. A non-expired submit that 500s produces: submit → results → back to take, no message, no retry. Autosave 500s have **no server-side log at all**. | `components/test/test-runner.tsx:232-236`, `app/(app)/tests/[id]/results/page.tsx:26-29`, `app/api/tests/[id]/answers/route.ts:70-72` | This is the app's core action failing invisibly on both sides. |
| 11 | **Banned users aren't blocked on the test API.** `answers` and `submit` check `!user` only, unlike every other route. Banning also doesn't revoke the Supabase session. | `app/api/tests/[id]/answers/route.ts:17-20`, `submit/route.ts:18-21`; cf. `app/api/tests/route.ts:22-24` | A banned user finishes in-flight tests and keeps direct PostgREST access until their JWT expires. |
| 12 | **`/admin/payments` doesn't exist, and disputes are unhandled.** `CUSTOMER.DISPUTE.*` falls to the ignore branch — the window where evidence must be filed is invisible. `PAYMENT.CAPTURE.REVERSED` *is* handled, so a lost dispute correctly revokes. | `lib/paypal-events.ts:66-85`; spec + SQL already written at `payments-backlog.md:29-50` | Turns the existing (good) payment data model into actual observability. Four queries, one page. |
| 13 | **No rate limiting anywhere in the repo,** including an unauthenticated Server Action that writes through the **service-role** client (contact form; honeypot + length caps only), `POST /api/paypal/orders` (mints a live PayPal order per call), and the auth routes. | `app/(marketing)/about/actions.ts:41-83`, `app/api/paypal/orders/route.ts:70` | Cost and spam exposure; an unusable admin inbox. |
| 14 | **`/admin/subjects` scans the entire `questions` table sequentially, per request** — `for (let from = 0; ; from += 1000)` with an `await` per page. A view that already computes this in one query (`subject_question_counts`) exists and is used elsewhere. Related: `test_questions` has no index leading with `question_id`, and an unbounded `.in()` on it is **silently truncated at `max_rows = 1000`**, making admin usage counts quietly wrong. | `lib/admin/taxonomy.ts:33-48`, `lib/admin/questions.ts:120`, `supabase/config.toml:18` | Linear degradation forever; one incorrect number today. |
| 15 | **Deleting a user is impossible.** `tests.user_id`, `attempts.user_id`, `subscriptions.user_id`, `questions.created_by`, `audit_logs.actor_id` are all default `NO ACTION`, so `auth.admin.deleteUser()` throws 23503. Intent clearly existed — `payments.user_id` *is* `on delete set null`. | `supabase/migrations/20260718000001_schema.sql:74,111,151,53,171` | No GDPR erasure, no "delete my account". |
| 16 | **No caching at all.** Zero `revalidate` / `unstable_cache` / `'use cache'`. The dashboard recomputes a non-materialized 5-table-join aggregate per request and pulls 400 rows to compute a streak in JS; the catalog is rebuilt in full to answer single-item lookups. 40+ `revalidatePath` calls invalidate caches that were never created. | `lib/stats.ts:24-30`, `app/(app)/dashboard/page.tsx:33-39`, `lib/catalog.ts:55-65` | Scaling cost, not a correctness bug. |

### P2 — accepted risk / backlog

Refund/chargeback promotes the buyer back to `trial`, which grants *all* exams
for their remaining quota (`lib/subscriptions.ts:56` + `lib/entitlements-core.ts:46`).
Entitlement is enforced at test *creation* only, so a chargeback doesn't stop
an in-flight test. Trial-credit *refund* is not compare-and-swap (the claim is —
`app/api/tests/route.ts:78-85` is genuinely atomic; only `refundTrial` at `:221-232`
is racy). Amount/currency mismatch logs and grants anyway. `question-images`
bucket grants `anon` a `select` policy on `storage.objects`, making the image
library listable, not just fetchable-by-URL. No security headers or CSP. Hard
deletes with no restore path for exams, specialties, plans and messages. The
`payments` migration's refund backfill keys on a JSON path that
`lib/payments-core.ts:275-283` says does not exist on refund payloads — a
no-op, but harmless with zero refunds to date. No backup/PITR/restore runbook.
`teams` page sells org billing that doesn't exist.

### Verified sound — do not re-litigate

Price, plan and exam are **not** client-tamperable: the order route accepts only
`{planId, examId}`, reads `price_cents` from the DB, and sets `custom_id`
server-side; the capture route re-derives the buyer from PayPal's own capture
resource and 403s on mismatch. Capture is idempotent under double-click
(`422/ORDER_ALREADY_CAPTURED` → re-fetch → COMPLETED, then a grant idempotent on
a real unique index with a 23505 race-loser re-read). Webhook signatures are
genuinely verified against the raw unre-serialized body, fail closed twice, and
replay is gated on a unique `paypal_event_id`. No IDOR anywhere in the exam
engine — all six read paths funnel through `getTestForUser(id, userId)`.
`is_correct` does not reach an in-progress client on any intended path. Timer
claims all hold. Open redirects are closed by `safeRedirectPath`. The admin
image-by-URL importer is genuinely SSRF-hardened. PostgREST filter injection is
handled. No secret has ever been committed. Every admin Server Action calls
`requireAdmin()` as its literal first statement. Zero TODO/FIXME in the codebase.

---

## Fix plan — the six P0s

Ordered by dependency, not severity. Steps 1–2 are checks, not code.

### Step 1 — Verify email deliverability (finding #2) · ~10 min · do this first

In the Supabase dashboard for the hosted project, confirm **Authentication →
Emails → SMTP Settings** has a custom provider (Resend/SendGrid/Postmark).
If it doesn't, configure one — signups are silently failing right now.

While there, also confirm (none of these live in the repo, all are hand-maintained,
and all fail silently):
- **URL Configuration** allow-lists `/auth/confirm`, `/reset-password` and the
  production site URL. Unlisted targets silently fall back to `site_url`.
- The **recovery email template** carries the `{{ .TokenHash }}` form from
  `supabase/templates/recovery.html`. Without it, reset links only work in the
  browser that requested them.
- Raise `email_sent` off 2/hour once real SMTP is in place.

Document all of it in `README.md` under a new "Hosted environment setup"
section — this is the second-biggest operational risk after #3, and it exists
entirely outside version control.

### Step 2 — Verify the cron is alive (finding #6) · ~5 min

```sql
select jobname, schedule, active from cron.job where jobname = 'reconcile-payments';
select name from vault.decrypted_secrets;              -- expect reconcile_url + reconcile_cron_secret
select * from cron.job_run_details order by start_time desc limit 10;
select * from audit_logs where action = 'payment.reconcile' order by created_at desc limit 5;
```

No `payment.reconcile` audit rows ⇒ the sweep has never actually done anything.
Create the two Vault secrets per `payments-backlog.md:146-149` and confirm
`CRON_SECRET` is set in the hosting env (it must match).

### Step 3 — Lock the question bank (finding #1)

**Approach:** column-level grants, *not* a blanket revoke. Two views over
`questions` are `security_invoker = true` (`subject_accuracy`,
`subject_question_counts` in `20260730000001_drop_topics.sql:30-58`) and run
with the caller's privileges — a blanket revoke makes every subject show **0
questions** across the test builder and catalog, silently, with no error
(`lib/catalog.ts:43` doesn't check the error and `catalog-core` falls back to
`?? 0`). A `security_invoker` view needs SELECT on exactly the columns it
references, and a column-level grant satisfies that — the same mechanism as the
existing `grant update (full_name) on profiles`.

1. **`lib/bookmarks.ts`** — deploy this *before* the migration. Drop the
   `questions(...)` embed from the RLS-client query (`:78-84`), and read the
   questions with `createAdminClient()` inside the existing `Promise.all` at
   `:100-113`, scoped `.in("id", questionIds)` where `questionIds` already comes
   from the caller's own bookmark rows. Re-apply in code the gate RLS gave for
   free — `if (q.is_published && q.deleted_at === null)` — so retired content
   still renders as "no longer available". Move the `attempts` read in the same
   `Promise.all` to the admin client too (still `.eq("user_id", userId)`), which
   Step 3's `attempts` column grant requires. `count: "exact"` on the root
   `bookmarks` query is unaffected. `BookmarkRow`, `BookmarksPage` and
   `components/bookmarks/bookmark-card.tsx` need **no change**.
   - Accepted regression: an admin browsing `/bookmarks` will see unpublished
     questions as unavailable (the old policy had an `or is_admin()` arm).
     Bookmarks is a learner surface; admins have `/admin/questions`.

2. **New migration `supabase/migrations/20260812000001_lock_question_reads.sql`:**
   ```sql
   revoke select on public.questions from authenticated;
   grant select (id, subject_id, is_published, deleted_at)
     on public.questions to authenticated;   -- exactly what the two views reference

   revoke all on public.question_options_public from authenticated;  -- zero readers, ever

   revoke select on public.attempts from authenticated;
   grant select (user_id, question_id, is_correct, answered_at)
     on public.attempts to authenticated;    -- withholds selected_option_ids = the answer key

   revoke select on public.test_questions, public.test_answers from authenticated;
   ```
   Comment the migration with **why a blanket revoke is unavailable**, and warn
   that changing either view to `q.*` (a whole-row reference) can only be
   satisfied by a table-level grant and would re-break them.

3. Update `CLAUDE.md` — "students read `question_options_public`" becomes false.

**Residual accepted:** a student can still learn *whether* they previously
answered a question correctly (`is_correct` is needed by all three analytics
views). Closing that means making those views definer with a `user_id = auth.uid()`
predicate, which breaks `lib/admin/users.ts:162-164` (service-role reads of the
same views for an arbitrary user). Not worth bundling into a security hotfix.

### Step 4 — Record every capture (finding #4)

No migration needed — `payments.user_id` is already nullable with
`on delete set null`, and `custom_id` has no format check.

1. **`lib/payments.ts`** — widen `recordCapture`'s `userId` to `string | null`;
   skip the profile pre-check when null (`grant_failure: "unknown_user"` is
   already the right value there). Pure widening; the existing caller is
   unaffected.
2. **`lib/subscriptions.ts`** — add `recordCaptureWithoutGrant(admin, order, failure)`
   next to `recordCapturedPurchase`, keeping the route out of the `lib/payments.ts`
   primitives. It records the money, optionally stamps `recordPaymentGrant({kind:"failed"})`
   (already guarded on `subscription_id is null`, so a webhook that linked the row
   first is safe), and audits via the existing `payment.grant_failed` action —
   no new audit action, no new enum value, no migration.
3. **`app/api/paypal/orders/[orderId]/capture/route.ts`** — hoist
   `createAdminClient()` above the `capture`/`parsed` block, then:
   - **502 path** (`:59-62`): record attributed to the session user with the raw
     `custom_id` verbatim and `grant_failure: "unknown_plan"` — the buyer is
     known, the *product* isn't. This row is the **only** record this money will
     ever get, because the webhook drops the same event for the same reason.
   - **403 path** (`:66-68`): **leave the 403 exactly as it is.** Record the
     money in the **buyer's** name (from the server-set `custom_id`, not the
     session), with `grant_failure` null — nothing has failed, the grant just
     hasn't happened. `subscription_id is null` is the sweep's cue, and Step 5's
     `custom_id` fallback then self-heals it within 15 minutes.

Neither path can break the response: `recordCapture` returns `null` on DB error
rather than throwing, and `recordPaymentGrant`/`audit` swallow their own failures.

### Step 5 — Stop Pass B starving, and make it self-heal (finding #5)

Ship with Step 4 — Step 4's 403 path depends on this to recover.

1. **Migration `20260812000002_payment_repair_attempts.sql`:** add
   `repair_attempts int not null default 0`, `last_repair_at timestamptz`,
   `last_repair_error text` to `payments`, plus
   `create index payments_repair_idx on payments (created_at) where subscription_id is null`
   to match Pass B's scan order. No grant needed — `payments` uses a column-list
   grant for clients, so new columns are withheld automatically. Mirror the
   fields into `Payment` in `lib/supabase/types.ts` (hand-maintained).
2. **`lib/reconcile-core.ts`** (pure, per the repo's `-core` convention): add
   `MAX_REPAIR_ATTEMPTS = 5`, `REPAIRABLE_STATUSES`, `isRepairEligible()`, and
   `resolvePurchaseIntent()` — the last recovers `planId`/`examId` from
   `custom_id` when the columns are null, importing the existing
   `parsePurchaseCustomId` from `lib/subscriptions-core.ts` rather than
   restating the format. Columns win over `custom_id` on disagreement. Critical
   subtlety: `exam_id` is only written *after* a successful grant, so on an
   unclaimed row `custom_id` is the **only** record of which exam was bought —
   falling through to `null` would silently grant all-access. Only a
   two-segment (legacy) `custom_id` may resolve to null.
3. **`lib/reconcile.ts`**: add `.lt("repair_attempts", MAX_REPAIR_ATTEMPTS)` to
   the scan; count and report quarantined rows in the summary exactly as Pass A
   does; **claim before working** (increment `repair_attempts` + set
   `last_repair_at` before the repair, so a platform timeout still burns an
   attempt); change `repairPayment` to return `{ok:false, reason}` so the caller
   can persist `last_repair_error`; route the `!plan_id`/`!user_id` branches
   through `resolvePurchaseIntent` and, on a recovered grant, use
   `recordPaymentGrant` rather than `linkPayment` so the repaired row becomes a
   complete receipt.
4. **Tests** in `tests/unit/reconcile-core.test.ts`: the `repairAttempts ===
   MAX_REPAIR_ATTEMPTS - 1` vs `=== MAX_REPAIR_ATTEMPTS` boundary pair is the
   regression test for the starvation bug; `partially_refunded` is eligible while
   `refunded`/`denied`/`reversed` are not; a 3-segment `custom_id` must never
   collapse `examId` to null; garbage `custom_id` → `null`.

**Deploy order note:** Step 3 is code-first (so `/bookmarks` is never wrong);
Step 5 is **migration-first** (the new scan selects `repair_attempts`, and
against the old schema Pass B errors and does nothing).

### Step 6 — Get eyes on production (finding #3)

Wire `@sentry/nextjs` with `instrumentation.ts` + `onRequestError`. Then make
the existing signals reach a human — at minimum alert on
`paypal_amount_mismatch`, `payment.grant_failed`, `reconcile_event_replay_failed`,
`payment.reconcile_failed`, and a **heartbeat check**: newest `payment.reconcile`
audit row older than ~2h means the cron is dead.

Add a server-side `console.error` to `app/api/tests/[id]/answers/route.ts:70-72`,
which currently 500s with no server-side trace at all.

The `/admin/payments` page (#12) is the natural follow-on — the four queries are
already written in `payments-backlog.md:31-40` — but Sentry is what unblocks
everything else, so it goes first.

---

## Verification

**Step 3** — locally, `npx supabase db reset`, then impersonate a learner in psql:
```sql
select set_config('request.jwt.claims',
  json_build_object('sub','<user-uuid>','role','authenticated')::text, true);
set local role authenticated;

select stem, explanation from public.questions limit 1;      -- expect ERROR 42501
select * from public.questions limit 1;                      -- expect ERROR 42501 (whole-row)
select id, subject_id from public.questions limit 1;         -- expect rows
select * from public.subject_question_counts limit 5;        -- MUST be non-empty, counts > 0
select * from public.subject_accuracy where user_id = '<user-uuid>';  -- expect rows
select * from public.user_stats;                             -- expect one row
select selected_option_ids from public.attempts limit 1;     -- expect ERROR 42501
select question_id, is_correct from public.attempts limit 1; -- expect rows
select * from public.test_questions limit 1;                 -- expect ERROR 42501
select * from public.question_options_public limit 1;        -- expect ERROR 42501
```
`subject_question_counts` returning zero rows is the **silent catalog outage**
canary — it fails without an error page, so check it explicitly. Then over the
wire with the publishable key + a real user JWT:
`curl "$SUPABASE_URL/rest/v1/questions?select=stem,explanation&limit=1"` → 42501.

UI pass: `/dashboard` (weak areas + stats populated), `/tests/new` (per-subject
counts non-zero), `/bookmarks` (stems, subject badges, expanded detail on
attempted questions, "no longer available" on an unpublished one),
`/tests/[id]/review`, `/profile`.

After deploying, confirm the ACL actually landed on production — if anyone has
ever run a `grant` in the SQL editor, the migration's revoke may be incomplete:
```sql
select grantee, privilege_type from information_schema.role_table_grants
 where table_name in ('questions','attempts','test_questions','test_answers')
   and grantee = 'authenticated';                 -- expect zero rows
```

**Steps 4–5** — seed two rows locally and run the sweep six times:
```sql
insert into payments (paypal_order_id, custom_id, source, status, created_at)
values ('TEST-POISON', 'garbage', 'backfill', 'captured', now() - interval '1 day'),
       ('TEST-HEAL', '<user>:<plan>:<exam>', 'backfill', 'captured', now() - interval '1 day');
```
```bash
curl -X POST localhost:3000/api/cron/reconcile -H "Authorization: Bearer $CRON_SECRET"
```
Expect: `TEST-HEAL` granted on run 1 with `subscription_id`, `plan_id`,
`plan_name`, `exam_id` all populated and a matching `subscriptions` row;
`TEST-POISON` climbing `repair_attempts` 1→5 with `last_repair_error` set, then
**leaving `scanned`** and appearing in `quarantined` from run 6 — that transition
is the fix.

Then in PayPal **sandbox**: create an order as user A and capture it as user B
(two browsers) → expect HTTP 403 *and* a `payments` row with `user_id = A`,
`grant_failure` null; run the sweep and confirm it self-heals to a real
subscription for A. Regression: one clean sandbox purchase end-to-end — 200,
subscription granted, exactly one `payments` row.

**Every step** — `npx tsc --noEmit && npm run lint && npx vitest run`.

---

## Flags

- Nothing here was executed against a live Postgres. The `security_invoker` +
  column-ACL reasoning in Step 3 is from documented semantics; the local
  `set role authenticated` script is **not optional** before this reaches
  production.
- Production ACLs may differ from what the migrations say if anyone has run
  `grant` statements in the SQL editor. Diff before and after.
- **Related hole, deliberately out of scope:** `lib/paypal-events.ts:93,116`
  drops the event entirely when `custom_id` is unparseable — money captured
  through the *webhook* path with a bad `custom_id` is recorded nowhere.
  Same class as Step 4's 502 path; worth its own ticket.
- **Also noted:** `app/(app)/bookmarks/actions.ts:38` lets a user insert a
  bookmark for any question id with no existence check. After Step 3 it leaks
  nothing, but it still allows unbounded writes keyed to arbitrary uuids.
