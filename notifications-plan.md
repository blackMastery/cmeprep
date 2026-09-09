# Email notifications — students and org admins

Implementation plan for the student- and org-admin-facing emails. Platform-admin
alerts (reconcile findings, webhook failures, moderation digests) are a separate
piece of work and are not covered here.

**Status (9 Sept 2026): all six phases implemented.** Where the code differs
from the plan below:

- Rows are delivered immediately after the response that queued them
  (`after()` in `lib/email.ts`); the five-minute `deliver` job is the safety
  net for failed sends, the daily scan's bulk rows and crashed runs, not the
  primary path the plan described.
- The `resend` SDK is the only new dependency; its idempotency key (the
  row's dedupe key) closes the crash-mid-send duplicate path. The templates
  are hand-written HTML in `lib/email-core.ts` rather than React Email, so
  the copy stays in a pure module vitest renders end to end.
- `email_outbox.template` is not CHECK-constrained; the worker skips unknown
  names instead. The table also has `skip_reason` and `provider_id` columns.
- The footer unsubscribe link is a confirmation page (`/unsubscribe/[token]`)
  so link-following mail scanners cannot act; the RFC 8058 one-click POST
  target is `/api/unsubscribe`, sent in the `List-Unsubscribe` header.
- The cron jobs reuse the `reconcile_cron_secret` Vault secret (the shared
  `CRON_SECRET`) and add only `email_url`.
- The report-resolved hook lives in the existing `resolveOpenReports`
  (`lib/admin/question-reports.ts`), which all three close paths already
  called — no new helper was needed. The audience helper is
  `assignmentAudienceUserIds` in `lib/orgs.ts`.
- The weekly digest reads the study plan only as "a plan exists for this
  week" plus a link; goal-level progress needs the RLS-client plan reads and
  was left for a follow-up.

**Platform admins (added 9 Sept 2026, beyond this plan's scope):** a seventh
category `admin_operations` (migration `20260909000002`) and five templates —
`admin_contact_message` (immediate, every admin), `admin_question_reported`
(immediate on a public-bank report, batched per question until resolved),
`admin_review_submitted` (immediate, every admin, with the review text),
`admin_daily_digest`
(messages, question reports and pending reviews; silent on an empty day),
`admin_import_finished` (transactional, to the importer),
`admin_failure_alert` (OSCE grading or translation failures reaching
`FAILURE_ALERT_THRESHOLD` in 24h, one per kind per day) and
`admin_role_changed` (transactional, every admin). `/admin/emails` is the
outbox monitor: status counts, last scan/delivery, run either job by hand,
re-queue a failed or skipped row, and preview or send yourself any template's
sample (`lib/email-samples.ts`).

Today the only mail is Supabase auth mail (verify, reset, invite for brand-new
accounts). Everything below is in-app only or missing entirely. See
[payments-backlog.md](payments-backlog.md) for the receipt and expiry entries
this plan closes.

## Ground rules

- **Outbox, never direct sends.** Every email is a row in `email_outbox`
  written by the code path that produced the event. A cron worker delivers.
  This keeps the payments rule (money recorded first, everything else after),
  gives retries for free, and makes idempotency a unique index rather than a
  convention.
- **Dedupe key per row.** Each template defines its own key shape
  (`receipt:{paypal_order_id}`, `expiry:{user}:{exam}:{period_end}:{7}` …).
  Inserts use `on conflict do nothing`, so capture, webhook and reconcile can
  all try to send the same receipt and exactly one goes out.
- **Two kinds of mail.** *Transactional* (receipt, refund, invite, removal,
  certificate) cannot be turned off. *Optional* (reminders, digests, report
  updates, org event pings) has a per-category toggle and a one-click
  unsubscribe link.
- **Core / server split.** Subject and body copy, the template → category map,
  dedupe key builders and the preference check live in `lib/email-core.ts`
  (pure, vitest). Sending, outbox IO and recipient lookup live in
  `lib/email.ts` (`server-only`).
- **Nothing an email says may leak what the app protects.** No correct
  answers, no explanations, no exam-document titles for locked exams, no
  per-member scores to anyone who is not an org admin of that org.

## Phase 0 — foundation

Everything else depends on this. Ship it alone, with the log transport, before
any template.

**Provider.** Resend with React Email for templates. Two env vars:
`RESEND_API_KEY` and `EMAIL_FROM`. A third, `EMAIL_TRANSPORT=log|resend`,
defaults to `log` so local dev and any env without a key writes the rendered
mail to the console and marks the row `skipped` instead of failing.

**Migration `email_outbox`.**

| column | notes |
| --- | --- |
| `id uuid pk` | |
| `user_id uuid references profiles on delete cascade` | recipient; org-admin mail still targets one profile per row |
| `template text` | check-constrained to the registry below |
| `payload jsonb` | everything the template needs, already resolved (names, amounts, URLs) |
| `dedupe_key text unique` | |
| `status text` | `queued`, `sent`, `failed`, `skipped` |
| `attempts int`, `last_error text` | |
| `scheduled_for timestamptz default now()` | lets a scan enqueue tomorrow's 1-day reminder today |
| `sent_at`, `created_at` | |

Index on `(status, scheduled_for)` for the worker. Grants: `service_role`
only, deny-all to client roles. Update `lib/supabase/types.ts` in the same
change.

**Migration `notification_preferences`.** One row per profile, created lazily.

| column | default | covers |
| --- | --- | --- |
| `expiry_reminders` | true | access ending |
| `assignment_reminders` | true | due soon, overdue, new assignment |
| `report_updates` | true | your question report was resolved |
| `weekly_digest` | **false** | Monday study summary |
| `org_admin_events` | true | member joined / removed, reports on org questions, org expiry |
| `org_assignment_summary` | true | assignment closed summary |
| `unsubscribe_token uuid default gen_random_uuid()` | | one-click links |

RLS: select and update own row. The unsubscribe route
`GET /unsubscribe/[token]?category=` flips one flag without a session and
renders a confirmation page.

**Recipient email.** `user_emails` is the only place the app reads a real
address. Extend the view with `email_confirmed_at is not null as confirmed`
and have the worker skip unconfirmed rows. Never send to an unverified address.

**`lib/email-core.ts`.**

- `EmailTemplate` union and `TEMPLATE_CATEGORY: Record<EmailTemplate, Category | 'transactional'>`.
- `dedupeKey(template, parts)` builders, one per template.
- `renderEmail(template, payload): { subject, text, react }` — copy lives here.
- `shouldDeliver(template, prefs)` — transactional always true.
- `groupForUser(rows)` helpers used by scans that collapse many events into one mail.

**`lib/email.ts`.**

- `enqueueEmail(admin, { userId, template, payload, dedupeKey, scheduledFor? })` — insert, ignore conflict, never throw (log like `audit()` does; an email must never fail the action that triggered it).
- `deliverOutbox(deadline)` — pull `queued` rows due now in batches of 50, join `user_emails` and preferences, skip or send, update status. Budget against the deadline like `hasBudget` in `lib/reconcile-core.ts`.
- `orgAdminRecipients(admin, orgId, excludeUserId?)` — org_members where role = 'admin'.

**Cron.** `POST /api/cron/email` with the same `CRON_SECRET` bearer check and
`maxDuration = 60` as reconcile. Body `{ job: 'deliver' | 'scan' }`.
`deliver` runs every 5 minutes. `scan` runs once a day at 08:00
America/Guyana (the timezone `user_daily_activity` already buckets by) and
enqueues the reminders in phases 2, 4 and 6. Schedule from a migration
mirroring `20260810000002_payment_reconciliation.sql`, with vault secrets
`email_url` and `email_cron_secret`. Each scan writes one summary
`audit_logs` row (`email.scan`), not one per email.

**Profile UI.** An "Email notifications" card on `/profile` with the six
toggles, saved by a server action that starts with `requireUser()`.

**Tests.** `tests/unit/email-core.test.ts`: every template renders with a
sample payload, dedupe keys are stable, `shouldDeliver` respects preferences
and ignores them for transactional templates.

## Phase 1 — money

**Purchase receipt** (`purchase_receipt`, transactional). Hook where a payment
becomes a grant: the `kind: 'granted'` write inside `recordPaymentGrant` in
`lib/payments.ts`. That single point is reached by the capture route, the
webhook and the reconcile repair, so a browser that died mid-checkout still
gets a receipt. Dedupe `receipt:{paypal_order_id}`. Payload: plan name, exam
name, amount and currency formatted by the existing money helper, access-until
date, PayPal order id. Closes the receipts entry in the backlog.

**Org purchase receipt** (`org_purchase_receipt`, transactional). Same hook on
the org path in `recordCapturedOrgPurchase`. Recipients: the purchaser plus
every org admin. Dedupe `org_receipt:{paypal_order_id}:{user}`.

**Refund recorded** (`refund_recorded`, transactional). In
`handleCaptureRefunded` in `lib/paypal-events.ts`, after the running total is
updated and only when it actually changed. Payload: refunded amount this time,
total refunded, original amount, and a plain statement that access is
unchanged (partial refunds are recorded, not punished). Dedupe on the refund
resource id from the event. Denied and reversed captures send a variant that
says access was withdrawn.

## Phase 2 — expiry reminders

**Student** (`access_expiring`, category `expiry_reminders`). Daily scan:
select subscriptions ending within `EXPIRY_WARNING_DAYS + 1` days, group by
user, run `expiryWarnings(subs, now)` from `lib/entitlements-core.ts` so the
email and the banner can never disagree on thresholds. Enqueue when
`daysLeft` is 7 or 1. Dedupe `expiry:{user}:{exam|all}:{period_end}:{days}`;
a renewal changes `period_end` and therefore re-arms the key naturally.
Payload: exam name, end date, renew URL. Move the renew-plan resolution out of
`components/subscriptions/expiry-banners.tsx` into a shared helper so both
build the same `/checkout/{planId}?exam=` link. Closes the expiry entry in the
backlog.

**Org** (`org_access_expiring`, category `org_admin_events`). Same scan over
`org_subscriptions`, recipients from `orgAdminRecipients`, link to
`/org/billing`.

## Phase 3 — org invites and membership

**Invite for an existing account** (`org_invite`, transactional). In
`inviteMembers` in `app/org/members/actions.ts`, the branch that finds the
email in `user_emails` currently relies on the dashboard banner alone.
Enqueue to that user with the accept URL `/org/join/{inviteId}`. Dedupe
`org_invite:{inviteId}`. `resendInvite` includes the resend timestamp in the
key so a resend actually sends. Brand-new addresses keep going through
`inviteUserByEmail` untouched.

**Member joined** (`org_member_joined`, `org_admin_events`). In `acceptInvite`,
to all org admins except the inviter if they are the same person.

**Member removed** (`org_member_removed`, transactional to the member, and an
`org_admin_events` copy to the other admins). In `removeMember`. The member's
copy repeats the action's own line: their personal account is untouched.

**Role changed** (`org_role_changed`, transactional). In `setMemberRole`, to
the affected member only.

## Phase 4 — assignments

Needs one refactor first: extract an `assignmentAudienceUserIds(admin,
assignment)` helper from the cohort logic inside `listAssignmentProgress` in
`lib/orgs.ts`, so reminders and the summary resolve "who is this for" exactly
the way the progress table does.

**New assignment** (`assignment_created`, `assignment_reminders`). Enqueued by
the create action to every audience member. Payload: title, due date, launch
URL `/assignments`.

**Due soon** (`assignment_due_soon`). Daily scan: assignments not deleted with
`due_at` in the next 48 hours. For each audience member with no submitted test
carrying that `assignment_id`, enqueue. Dedupe `assign_due:{assignment}:{user}`.

**Overdue** (`assignment_overdue`). Same scan, `due_at` in the last 24 hours,
same completion check. Dedupe `assign_overdue:{assignment}:{user}`. One
overdue mail, never a daily nag.

**Assignment closed summary** (`assignment_summary`, `org_assignment_summary`).
Daily scan: assignments whose `due_at` passed in the last 24 hours. Compute
completed count, the names of members who did not finish, and mean score from
the same rows `listAssignmentProgress` reads. Recipients: org admins. Dedupe
`assign_summary:{assignment}`. Per-member names and scores go only to org
admins of that org; this matches the aggregate-only model in SPEC §7.

## Phase 5 — certificates and reports

**Certificate issued** (`certificate_issued`, transactional). In
`mintCertificate` in `lib/certificates.ts`, right after the insert, so the
quiet variant is covered too. Payload: course title, credential name, issued
date, link to `/cme/certificates` and the public verify URL. Start with a
link; attaching the PDF from `lib/certificate-pdf.ts` is a follow-up once
sizes are known.

**Report resolved** (`report_resolved`, `report_updates`). Reports are closed
from three places in `app/admin/questions/actions.ts`: editor save (`fixed`),
delete (`not_actionable`) and the explicit resolve action. Add a
`closeQuestionReports()` helper in `lib/question-reports.ts` that all three
call, which writes the resolution and enqueues. Bulk closes are grouped per
reporter by a core helper so a mass delete produces "3 of your reports were
resolved", not three mails. Dedupe `report_resolved:{reportId}` (grouped rows
use the sorted id list). The body names the question by a short stem excerpt
and the resolution only. Never the corrected answer.

**Report on an org question** (`org_question_reported`, `org_admin_events`).
In `fileQuestionReport`, when the reported question belongs to an org, enqueue
to that org's admins with a link to `/org/content/reports`. Dedupe
`org_report:{reportId}`.

## Phase 6 — weekly digest

(`weekly_digest`, opt-in, default off.) Monday scan for users with the flag
on and at least one attempt in the previous seven days. Inactive users get
nothing; a "we missed you" mail is a product decision for later. Content:
streak, attempts and accuracy this week, weakest subjects from the readiness
data behind `getOwnReadiness`, and the current study-plan week from
`getPlanCard`. Those two functions read through the RLS client with a
session, so the scan needs admin-client twins or a core function that takes
the rows. Dedupe `digest:{user}:{isoWeek}`.

## Order and size

| phase | depends on | size |
| --- | --- | --- |
| 0 foundation | — | 2–3 days |
| 1 money | 0 | 1 day |
| 2 expiry | 0 | 1 day |
| 3 org membership | 0 | 1 day |
| 4 assignments | 0, audience refactor | 2 days |
| 5 certificates and reports | 0 | 1–2 days |
| 6 weekly digest | 0, admin-client stats | 2 days |

Phases 1 to 5 are independent of each other once 0 lands and can go in any
order; 1 and 2 are the revenue ones and should go first.

## Deployment checklist

1. Verify the sending domain in Resend (SPF and DKIM) before switching
   `EMAIL_TRANSPORT` to `resend` in production.
2. Set `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_TRANSPORT` in the hosting env.
3. Create the vault secrets `email_url` and `email_cron_secret` and apply the
   cron migration. Supabase commands are yours to run; the migration prints
   the same "schedule by hand" notice as reconcile when pg_cron is absent.
4. Run one manual `POST /api/cron/email` with `{ job: 'scan' }` and confirm
   the outbox fills and the summary audit row appears.
5. Add `notification_preferences` and `email_outbox` to the profile and admin
   user pages as read-only history once the volume justifies it.
