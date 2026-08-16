# SPEC — Teams & Enterprises (v1)

Implements the offering marketed on [app/(marketing)/teams/page.tsx](<app/(marketing)/teams/page.tsx>):
org accounts with seat-capped access, an org-admin role, private question banks,
content assignment, an org dashboard with risk flagging, org-scoped audit logs,
custom branding, a configurable pass mark, and dual purchase paths (self-serve
PayPal + admin-provisioned invoice/PO).

All decisions below were made in an interview on 2026-08-13.

---

## 1. Scope

### In v1

| Capability | Shape |
| --- | --- |
| Org accounts | Seat-capped (90 on the Team plan), invite-only membership, one org per user |
| Org-admin role | On the membership row, not `profiles.role` |
| Entitlements | Org grant computed at read time; org subs are **per exam** (`org_subscriptions.exam_id`, null = admin comp all-access) + the org's own private banks ride on any live sub |
| Private question banks | Org-scoped **exam trees** (`exams.org_id`), authored by org-admins with a scoped editor + xlsx importer |
| Content assignment | Task-style: assignment = prescribed test config + due date; members keep full access regardless |
| Org dashboard | Roster, per-member aggregates, risk flagging (below pass mark OR inactive) |
| Custom branding | Org logo (+ name) in the app shell for members |
| Pass mark | Org-configurable %, drives risk flagging |
| Audit logs | Org-admin actions logged with `org_id`; org-scoped read-only log page |
| Billing | PayPal self-serve (org exists first, then buys) AND platform-admin manual provisioning (invoice/PO path) |
| Org expiry | 14-day grace with banners, then lock; private bank retained |
| Platform admin | Full org CRUD in `/admin`: create, seat cap, period end, suspend, members, transfer org-admin, payments view |

### Explicitly out of v1

- SSO/SAML and SCIM — remains "contact sales". (Supabase SAML SSO is the
  likely path later; nothing in this design blocks it.)
- ~~Sub-teams / named groups as assignment targets (assign to all or to
  selected individuals only).~~ **Built (2026-08-15) as Departments**: one
  department per member (`org_members.department_id`), org-admin-managed from
  the Members tab, a dynamic `department` assignment audience (cohort =
  current members assigned before the due date), a dashboard department
  filter + comparison strip with an "Unassigned" pseudo-department, optional
  department on invites, and a read-only member-facing label. Departments
  hard-delete (FKs SET NULL); no department-lead role, no per-department
  threshold overrides.
- Domain auto-join and shareable join links (invites only, strictly bound to
  the invited email).
- Member-level access logging ("who viewed what") — only admin *actions* are
  audited in v1.
- Multi-org membership (DB shape allows it later; v1 enforces one org per user).
- Brand colors / full theming (logo + name only).
- A transactional email provider — Supabase auth mailer only.
- Read-only wind-down state after expiry (grace → lock, nothing in between).
- Question-by-question drill-down for org-admins (aggregates only — privacy
  decision, see §7).

---

## 2. Data model

New migration(s) + matching hand edits to [lib/supabase/types.ts](lib/supabase/types.ts)
in the same change. **Every new table needs explicit grants** (see
`..._grants.sql` convention) or all queries fail with "permission denied".

### New tables

```sql
orgs (
  id uuid pk default gen_random_uuid(),
  name text not null,
  logo_path text,                        -- storage object in org-branding bucket
  pass_mark_pct int not null default 60  check (pass_mark_pct between 1 and 100),
  risk_inactivity_days int not null default 7 check (risk_inactivity_days between 1 and 90),
  seat_limit int not null default 90 check (seat_limit > 0),
  suspended_at timestamptz,              -- platform-admin kill switch
  created_by uuid references profiles,
  created_at / updated_at
)

org_members (
  org_id uuid not null references orgs,
  user_id uuid not null references profiles,
  role text not null check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id),
  unique (user_id)          -- ONE org per user in v1; drop this to enable multi-org
)

org_invites (
  id uuid pk,
  org_id uuid not null references orgs,
  email citext not null,                 -- requires `create extension if not exists citext`
                                         -- (not yet enabled in any migration); alternatively
                                         -- text + unique index on lower(email)
  role text not null default 'member' check (role in ('admin', 'member')),
  invited_by uuid references profiles,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,       -- created_at + 14 days
  accepted_at timestamptz,
  revoked_at timestamptz,
  unique (org_id, email) where accepted_at is null and revoked_at is null  -- partial unique index
)

org_subscriptions (
  id uuid pk,
  org_id uuid not null references orgs,
  plan_id uuid references plans,         -- soft link, null for bespoke admin grants
  plan text not null,                    -- free-text snapshot, mirrors subscriptions.plan
  status sub_status not null default 'active',
  current_period_end timestamptz not null,
  created_at / updated_at
)

org_assignments (
  id uuid pk,
  org_id uuid not null references orgs,
  title text not null,
  description text,
  config jsonb not null,                 -- TestConfig shape (subject_ids, difficulty,
                                         -- num_questions, duration_sec, exam_id)
  due_at timestamptz not null,
  audience text not null default 'all' check (audience in ('all', 'selected')),
  created_by uuid references profiles,
  created_at timestamptz not null default now(),
  deleted_at timestamptz                 -- soft delete, matching questions convention
)

org_assignment_targets (
  assignment_id uuid not null references org_assignments,
  user_id uuid not null references profiles,
  primary key (assignment_id, user_id)
)  -- rows only when audience = 'selected'
```

### Altered tables

```sql
alter table exams    add column org_id uuid references orgs;   -- null = public catalog
alter table tests    add column assignment_id uuid references org_assignments;
alter table plans    add column kind text not null default 'personal'
                       check (kind in ('personal', 'org'));
alter table plans    add column seat_limit int;                -- org plans only (90 for Team)
alter table payments add column org_id uuid references orgs;   -- org purchases
alter table audit_logs add column org_id uuid;                 -- + index on (org_id, id desc)
```

`payments.grant_failure` gains a new allowed value: `'unknown_org'`
(text + check constraint, consistent with the existing non-enum approach).

### Type updates

`lib/supabase/types.ts`: add `Org`, `OrgMember`, `OrgInvite`, `OrgSubscription`,
`OrgAssignment`, `OrgAssignmentTarget`; extend `Exam` (`org_id`), `Test`
(`assignment_id`), `Plan` (`kind`, `seat_limit`), `Payment` (`org_id`),
`AuditLog` (`org_id`), `PaymentGrantFailure` (`unknown_org`). `TestConfig`
gains optional `assignment_id`? — no: `assignment_id` is a `tests` column, not
config; config stays as-is.

### RLS & grants

- New SQL helper `is_org_admin(org uuid)` — `security definer`, mirrors the
  existing `is_admin()` pattern. Needed to avoid recursive policies
  (an `org_members` policy that checks `org_members` directly recurses).
  Also `is_org_member(org uuid)`.
- `orgs`: members read their own org row (name/logo/pass mark for the shell);
  org-admins update the settings columns; platform admin via service role.
- `org_members`: user reads their own row; org-admins read all rows in their
  org. Writes go through server actions/routes only (service role after
  `requireOrgAdmin`) — no direct client INSERT/DELETE policies.
- `org_invites`: org-admins read their org's invites. Accept/revoke via server
  actions only.
- `org_subscriptions`: members read their org's rows (needed for banners /
  read-time grant via the RLS client); writes service-role only.
- `org_assignments` / `org_assignment_targets`: members read assignments
  addressed to them (`audience = 'all'` or a target row) in their org;
  org-admins read/write all in their org (mutations still via actions).
- `exams` (and by extension specialties/subjects/questions below it): existing
  read policies gain `and (org_id is null or is_org_member(org_id))`.
  Specialties/subjects/questions/options don't get their own `org_id` — they
  scope through their exam. Their read policies join up to the exam's
  `org_id`; keep the join shallow (questions → subjects → specialties → exams
  is already the taxonomy read path).
- `question_options` **stays revoked from client roles** — org content gets no
  exception. `question_options_public` is **deliberately SECURITY DEFINER**
  (`security_invoker = false` — it must bypass the base table's deny-all RLS;
  see `20260718000003_rls.sql`), so question RLS does NOT protect it. The org
  guard must go **into the view's WHERE clause**: join up to `exams` and add
  `(e.org_id is null or public.is_org_member(e.org_id))`. Column list is
  unchanged, so `create or replace view` preserves grants, matching the
  soft-delete recreation in `20260719000001_option_soft_delete.sql`.
- Storage: new `org-branding` bucket (logo uploads, org-admin write scoped by
  path prefix `org/{org_id}/…`, public read is acceptable for logos). Question
  images for org content reuse the existing question-images bucket under an
  org path prefix, same policies pattern as
  `20260719000002_storage_question_images.sql`.

---

## 3. Entitlements

**Decision: the org grant is computed at read time. No per-user
`subscriptions` rows are ever materialized for org members** — nothing to fan
out, revoke, or reconcile when membership churns.

### Core rules (in `lib/entitlements-core.ts` / `lib/orgs-core.ts`, pure + vitest)

**REVISED (per-exam change):** org subscriptions are scoped to ONE public
exam each (`org_subscriptions.exam_id`; null = admin comp all-access,
mirroring `subscriptions.exam_id`). Self-serve checkout always names an exam.

- `ORG_GRACE_DAYS = 14` in `orgs-core`. A row *grants* while effectively
  active OR 'active'-status inside its grace (`orgSubGrants`, per row).
  Org-wide state machine `active → grace → locked` still drives banners;
  cancelled rows get no grace. Per-exam trouble the org-wide state can't see
  (exam A lapsing while B keeps the org "active") surfaces via
  `orgExamAlerts` in the org layout.
- The org grant is an **orthogonal rider**, not an access kind:
  `ExamAccess = { kind, …, org: OrgAccess | null }` where
  `OrgAccess = { orgId, examIds, allAccess }`, built once by
  `orgAccessOf(orgCtx, now)` — non-null while a non-suspended org has any
  granting row. `canAccessExam` unions the rider with personal access;
  `kind: "none"` with a rider is a common ENTITLED state.
- Branch order in `examAccessFor`: admin → trial → legacy → scoped (the old
  "org before trial" constraint dissolved with all-or-nothing org access).
- **`consumesTrialCredit(role, access, exam)`** states the metering rule
  once: trial-role members are unmetered on org-covered exams (bought, comp,
  or the org's own bank) and quota-metered elsewhere.
- Private banks ride on ANY granting row, grace included — which exams were
  bought is irrelevant to bank access. `orgExamAllowed` still walls org
  exams to their own org's members (platform admins excepted for QA).
- Personal subscriptions union with the rider; no stacking interaction
  between org and personal periods. Org stacking is per (org, exam) with
  the same strict-null match as `activePeriodEndForExamPure`
  (`activePeriodEndForOrgExam`).

### DB wrapper (`lib/entitlements.ts`)

`examAccessFrom` / `getExamAccess` additionally fetch (one query each, RLS'd):
the caller's `org_members` row, and if present, that org's `org_subscriptions`
and `orgs.suspended_at`. All filtering stays in JS in the core, per the
existing convention.

---

## 4. Membership lifecycle

### Invites

- Org-admins invite by email (single + bulk paste). Role per invite
  (`member` or `admin`).
- **Seat rule (strict):** `accepted members + pending (unexpired, unrevoked)
  invites ≤ orgs.seat_limit`. The 91st invite is refused with a clear error.
  Enforced in the server action; to close the race, re-count inside the
  transaction after insert and roll back if over (or take a per-org advisory
  lock). Belt-and-braces, not a DB constraint.
- Invites **expire after 14 days** (`expires_at`); expired invites free the
  seat and can be re-sent.
- **Delivery:** for emails with no existing account,
  `supabase.auth.admin.inviteUserByEmail(email, { redirectTo: acceptUrl })` —
  the auth mailer does delivery and signup lands them on the accept page. For
  existing accounts, an in-app notification (banner on dashboard: "You've been
  invited to {org}") — same accept page; no new mail provider in v1.
- **Acceptance binds strictly to the invited email.** The accept page requires
  a session whose email equals the invite's email (citext compare). A user
  signed in under a different address sees "This invite is for
  j***@hospital.org — sign in with that address or ask your admin to re-invite
  this one." No claiming, no admin-approval flow.
- Accepting while already a member of another org fails ("one organisation per
  account — contact support"). The `unique (user_id)` constraint backstops it.
- Org-admins can revoke pending invites.

### Removal & departure

- Removal frees the seat immediately and drops the org grant at next read
  (no rows to clean up — read-time grant).
- The member **keeps their personal account and full history** (tests,
  attempts, streaks, bookmarks, notes).
- The org **keeps their contribution to aggregates** (their attempts rows are
  untouched; dashboard queries filter by *current* membership for the roster
  but historical cohort stats derived from attempts remain).
- **Departed-member review rule (decision):** past test *scores* stay in the
  member's history, but question-level review of private-bank items requires
  active membership. `lib/results.ts` marks such rows "content no longer
  available" (stem/options/explanation withheld) while still showing the
  per-question correct/incorrect status already stored on the immutable
  `attempts` row. This falls out of RLS naturally — the org-exam read policy
  stops matching — but results must render the gap gracefully, not 404.
- Mid-test edge: a member removed (or org locked) while a test is
  `in_progress` may still **submit** — scoring is server-side via
  `lib/tests.ts`/`lib/scoring.ts` and the expiry-scoring path already handles
  staged answers. Only *review* is gated afterwards.
- Transfer of the org-admin role: platform admin can do it from `/admin`
  (support path); an org-admin can promote another member and demote
  themselves, but the last remaining org-admin cannot demote/remove
  themselves.

---

## 5. Billing & provisioning

Two grant paths from day one, both idempotent, both landing in
`org_subscriptions`:

### Path A — self-serve PayPal

- **Org exists first** (decision): any signed-in user can create an org
  (name only, free, becomes its org-admin, seat_limit defaults from nothing
  yet — org is *unentitled* until a subscription exists). Then from
  `/org/settings/billing` the org-admin checks out an org plan.
- `plans` gains `kind = 'org'` rows (seed: **Team, $1,200/year PER EXAM,
  seat_limit 90, duration 12 months**). Org plans never appear in the
  personal checkout list and vice versa (filter by `kind`). **REVISED:** the
  org billing page reuses the personal checkout's exam picker (`ExamChoice`
  with a `basePath` prop); one public exam per purchase, repurchase stacks
  that exam.
- `custom_id` gets a **versioned org format**: `orgv2:` + four
  base64url-packed uuids (user, plan, org, exam — 97 chars under PayPal's
  127 cap; four plain uuids would be 154). `subscriptions-core` parses both
  formats; the prefix disambiguates. (`orgv1:` carried no exam and never
  shipped; the parser refuses it.)
- `recordCapturedPurchase()` in [lib/subscriptions.ts](lib/subscriptions.ts)
  branches on the parsed shape / `plan.kind`:
  1. write the `payments` row (with `org_id`) **before** attempting the grant
     — unchanged money-first invariant;
  2. grant = insert/extend `org_subscriptions` for that org, **stacking**:
     new period end = max(now, latest effectively-active period end for the
     org) + plan duration — mirroring the personal per-exam stacking rule;
  3. on grant, set `orgs.seat_limit` from `plans.seat_limit` (only raise,
     never lower automatically);
  4. failure taxonomy: `grant_failure = 'unknown_org'` when the org id
     doesn't resolve; existing values reused otherwise.
- Idempotent on `paypal_order_id`; capture route and webhook race
  deliberately, unchanged. The `pg_cron` reconcile sweep
  (`/api/cron/reconcile`) picks up org payments with `subscription_id is null`
  the same way — extend `reconcile-core` to re-attempt org grants. (Note:
  `payments.subscription_id` stays null for org purchases; add
  `payments.org_subscription_id`? **Decision for implementer:** add
  `org_subscription_id uuid` to `payments` so "granted" is expressible for
  both kinds and the sweep's null-check works unmodified per kind.)
- Buyer identity: the payer must be an org-admin of the target org at order
  *creation* time (checked server-side when creating the PayPal order).

### Path B — admin-provisioned (invoice / PO)

- Platform admin creates the org (or takes over a self-created one), sets
  `seat_limit` and inserts an `org_subscription` with a chosen
  `current_period_end` from `/admin/orgs/[id]` — this **is** the invoice/PO
  fulfilment step after money arrives out-of-band. Every such mutation goes
  through `audit()`.

### Expiry, grace, lock

- `current_period_end` passes → **grace (14 days)**: everything keeps
  working; org-admins see a prominent banner ("Access ends for your whole
  team on {date}"), members see a soft banner in the final 3 days.
- Grace ends → **locked**: org grant stops; members fall back to personal
  subs/trial state; private bank becomes inaccessible to everyone including
  org-admins (content editor locked, data retained); assignments hidden;
  dashboard shows a renewal wall for org-admins. Renewal (either path)
  restores everything instantly — read-time grant means no re-provisioning.
- `orgs.suspended_at` (platform admin) behaves like locked, regardless of
  subscription state.

---

## 6. Private question banks & org authoring

- An org's bank is a full **org-scoped exam tree**: `exams.org_id = org` →
  specialties → subjects → questions, managed by org-admins.
- Org-admin content tooling is a scoped variant of the existing admin
  tooling, living under `/org/content`:
  - taxonomy CRUD (exams/specialties/subjects) limited to `org_id = their org`;
  - question editor (stem, options with correct flags, explanation, images,
    difficulty, publish toggle) — reusing the components behind
    `/admin/questions` where practical;
  - **xlsx importer**: same pipeline — reduce to a cell matrix at the server
    boundary ([lib/admin/import.ts](lib/admin/import.ts)), everything else in
    `import-core.ts` so preview and commit cannot drift. Same
    `IMPORT_ROW_CAP` / `CHUNK_SIZE` / `maxDuration` triple. New org routes
    (`/api/org/import/*`) guarded by `requireOrgAdminJson` (new, alongside
    [lib/admin/api-auth.ts](lib/admin/api-auth.ts)), which also pins the
    target subject to the caller's org.
- **Correctness firewall unchanged:** `question_options` remains revoked from
  client roles. Org-admins read/write `is_correct` exclusively through
  server-side org routes/actions (service-role client *after*
  `requireOrgAdmin` + row-belongs-to-org verification). `lib/scoring.ts`
  still never reaches a Client Component. Results/review still refuse
  correctness while a test is `in_progress`.
- Org questions participate in everything as normal questions: practice
  wizard (the org's exams appear alongside public ones for members),
  bookmarks, notes, stats, `subject_accuracy` (scoped by exam, so org rows
  don't pollute public-exam analytics).
- Soft deletes throughout (`deleted_at`), consistent with the platform.
- Platform admins can see org content (QA/support) via `/admin`; other orgs
  and non-members can never see it (RLS, §2).

---

## 7. Assignments

- **Assignment = prescribed test config + due date** (decision). Fields:
  title, optional description, `config` (validated by a zod schema matching
  `TestConfig`: exam, subject_ids, difficulty, num_questions, duration_sec,
  mode — `duration_sec` absent exactly when mode is `tutor`, see §16),
  `due_at`, audience (`all` | selected members).
- Member experience: an **Assignments** card on the existing dashboard +
  an assignments list page under `(app)`. Each shows title, due date, status
  (Not started / In progress / Completed / Overdue). "Start" creates a test
  from the assignment's config verbatim — the member configures nothing —
  and stamps `tests.assignment_id`.
- **Completion = a submitted test with that `assignment_id` that passes
  `qualifiesAsAssignmentCompletion` (lib/orgs-core.ts).** For exam mode that
  is any submitted attempt; a tutor run must also have **every question
  answered** — tutor scoring is correct/answered, so without the 100% bar a
  member could check 3 easy questions and read as done at 100%. Multiple
  attempts allowed; the dashboard reports the **latest** qualifying score.
  Overdue = past `due_at` with no qualifying attempt (late submissions still
  complete it, flagged "late").
- **Mode override (§16):** the org prescribes a mode; the member may launch
  the assignment in the other one. Overridden completions count, but both
  the member list and the org report label the mode actually used
  (`completedTutor` / `completedMode`).
- Config must reference content the org is entitled to (public exams or the
  org's own bank — which for an all-access org sub is anything visible to
  members). Validation at creation *and* at launch: if the subjects no longer
  have enough published questions at launch time, the existing test-creation
  guards apply and the member sees the same error surface.
- Assignments are hidden (not deleted) when the org locks; soft-delete for
  admin removal. Removing a member removes them from target lists implicitly
  (membership join).

---

## 8. Org dashboard & exam readiness (v2 — replaces the binary risk flag)

Org-admin pages under `/org` (server components; queries via the admin
client **after** `requireOrgAdmin`). Readiness is computed **read-time only**
(no snapshots, no cron); the date-bucketed aggregation lives in four
security-invoker views (`20260817000001_readiness.sql`):
`user_exam_weekly_mode_accuracy`, `user_exam_weekly_activity`,
`user_exam_stats`, `exam_subject_counts` — all exam-scoped through
attempts→questions→subjects→specialties, all requiring callers to filter on
their GROUP BY columns.

- **Readiness model (decision):** a 0–100 score per member **per entitled
  exam**, banded `on_track (≥75) / borderline (≥55) / at_risk /
  insufficient_data`, with named reason codes. Fixed product-owned formula
  (`memberReadiness`, lib/orgs-core.ts, vitest-pinned) — there is no
  ground-truth pass/fail data, so it is an explainable heuristic, never a
  fitted predictor. Weighted signals over an 8-ISO-week window
  (America/Guyana, Monday-start, matching the views):
  - **Blended accuracy (0.5)** vs `orgs.pass_mark_pct` — exam-mode attempts
    count double (tutor accuracy is inflated by instant feedback); falls back
    to per-exam all-time under 20 window attempts.
  - **Trend (0.15)** — recent 4 weeks vs prior 4; `declining_trend` at −5pts.
  - **Subject coverage (0.2)** — covered = ≥5 attempts at ≥50% per subject,
    over the exam's published-subject roster.
  - **Cadence (0.15)** — active days in the recent 4 weeks vs a 12-day target.
  Two **caps** keep the score below on_track regardless of the rest: no
  submitted exam-mode test in the window (`no_timed_practice` — keyed off
  tests rows, legacy null-test_id attempts can't satisfy it) and inactivity
  per `orgs.risk_inactivity_days` (`inactive`). The v1 reasons
  (`below_pass_mark`, `inactive`) survive as reason codes; the at_risk band
  subsumes the old binary flag. Below 20 attempts window AND all-time the
  band is `insufficient_data` with a **null score** — never a fake-precise
  number.
- **Sitting dates (decision):** optional per-org-per-exam `org_exam_dates`
  row, set on org settings (audited). **Framing only** — days-remaining copy,
  sort priority, "sitting passed" — bands and scores never move with the
  calendar. Members can read their own org's dates (RLS).
- **Surfaces:** dashboard table (score + band + reason chips + weekly
  sparkline, sortable, at-risk filter, exam picker when the org holds >1
  exam), per-member drill-down at `/org/members/[userId]` (signal breakdown,
  per-subject accuracy bars, mock history — scores only, pacing shown for
  context but never scored), department strip (avg readiness + band counts),
  CSV export (`GET /api/org/readiness`, `requireOrgAdminJson`).
- **Member-facing (decision):** the member dashboard shows their OWN score
  soft-framed as "Exam readiness" — same formula via RLS reads
  (`getOwnReadiness`), reasons rendered as guidance; the phrase "at risk"
  and the existence of the admin-side flag never appear member-side. Org
  members only in v1 (the inputs are org knobs).
- **Privacy boundary (decision, unchanged):** org-admins see **aggregates +
  readiness only** — overall and per-subject accuracy, activity,
  mock/assignment scores. **Never** individual answers, question-by-question
  review, notes, or bookmarks. Enforced in the org query layer (no code path
  from org pages into `lib/results.ts` review data), stated in the invite
  email/accept page ("Your organisation sees your aggregate performance, not
  your answers").
- **Assignment detail view:** per assignment — who completed (score, late
  flag), who hasn't started, due date.
- Cohort headline stats: average readiness + accuracy, active-this-week
  count, at_risk-band count, completion rate of open assignments.
- No notifications in v1 (consistent with read-time-only compute).

---

## 9. Branding & member-facing surface

- Org logo (upload, `org-branding` bucket) + org name shown in the `(app)`
  shell for members — e.g. "{logo} {Org name}" in the sidebar/header,
  alongside (not replacing) cmeprep branding. No color theming in v1.
- Grace-period and lock banners as per §5.
- The `(marketing)` teams page: swap the disabled "Coming Soon" button for a
  live CTA ("Create your organisation" → org creation for signed-in users /
  register first) and keep "Contact sales" for SSO/invoice needs. Remove the
  "Coming soon" chips.

## 10. Audit

- All org-admin mutations (invite, revoke, remove member, role change,
  content create/edit/delete, import commit, assignment CRUD, settings/
  branding change, billing checkout) go through `audit()`
  ([lib/admin/audit.ts](lib/admin/audit.ts)) with a typed action name and
  `org_id` set. Bulk operations (imports, bulk invites) write **one summary
  row**, per the platform convention.
- `/org/audit`: read-only, paginated, scoped to `org_id`, visible to
  org-admins. Reads via a guarded server route (audit_logs stays
  service-role; no new client RLS on it).
- Member content-access logging is **not** in v1 (documented gap vs. the
  compliance pitch — revisit with SSO work).

## 11. Platform admin (`/admin/orgs`)

- List (name, seats used/cap, subscription status incl. grace, created).
- Detail: edit name/seat cap; suspend/unsuspend; member roster with remove +
  role transfer; invites; **manual subscription grant/extend** (Path B) with
  plan picker or bespoke period end; payments filtered by `org_id`;
  org-scoped audit trail. Every mutation audited.

## 12. Routes & module layout (summary)

```
app/(app)/org/…                    org-admin area (layout guard: requireOrgAdmin)
  page.tsx                         dashboard (roster + risk + headline stats)
  members/  assignments/  content/ (taxonomy, questions, import)
  audit/    settings/  (branding, pass mark, billing/checkout)
app/(app)/assignments/             member-facing assignment list
app/(app)/org/join/[inviteId]/     invite accept page (guard: requireUser only)
app/admin/orgs/  app/admin/orgs/[id]/
app/api/org/import/…               org importer routes (requireOrgAdminJson)
lib/orgs-core.ts                   pure: seat math, invite validity, grace/lock
                                   state, risk computation, custom_id orgv1 parse
                                   (or extend payments-core for the parse)
lib/orgs.ts                        server-only DB layer (requireOrgAdmin,
                                   requireOrgAdminJson, roster/stats queries)
```

Server Actions follow the house rules: `requireUser()`/`requireOrgAdmin()` as
the **first statement, outside try/catch**; return
`{ error?, success? } | null` for `useActionState`. After adding routes run
`npx next typegen`.

## 13. Testing (vitest, pure cores)

- `examAccessFor` new branches: org before trial; org grant with grace;
  suspended org; lapsed-past-grace fallback to personal subs; org-exam
  visibility (`org_id` filtering incl. `kind:"all"` non-leakage across orgs).
- Seat math: cap counts accepted + pending; expired/revoked invites free
  seats; 91st refused.
- Grace state machine: active/grace/locked boundaries at exact timestamps;
  cancelled rows get no grace.
- Org period stacking on repurchase (mirrors `activePeriodEndForExamPure`).
- `custom_id` parsing: `orgv1:` format, legacy format untouched, malformed
  input → `unknown_org` / existing failures.
- Risk computation: rolling-window fallback rule, inactivity edge at exactly
  N days, pass-mark boundary (score == threshold is **not** at risk).
- Assignment status derivation (not started / in progress / completed / late
  / overdue).
- Reconcile-core: org payments with no grant are swept and re-granted.

## 14. Implementation order

1. Migration set 1 + types: `orgs`, `org_members`, `org_invites`,
   `org_subscriptions`, helpers, RLS, grants. `orgs-core` + entitlement
   changes + tests. (Everything else depends on the grant.)
2. Invites + membership lifecycle + accept page + seat enforcement.
3. Billing: plans `kind`, `custom_id` v2, `recordCapturedPurchase` org
   branch, reconcile extension, org checkout page; `/admin/orgs` (Path B).
4. Private banks: `exams.org_id`, taxonomy RLS updates,
   `question_options_public` WHERE-clause org guard, org content tooling +
   importer.
5. Assignments (+ `tests.assignment_id`, launch flow, member UI).
6. Dashboard + risk; audit page; branding; grace/lock banners; marketing
   page CTA swap.

Each step lands green on the full gate: `npm run lint`, `npx tsc --noEmit`,
`npx vitest run`.

## 15. Open questions (non-blocking, defaults chosen)

- Rolling-window constants for risk (30 days / 20-attempt fallback) — tune
  after real cohort data.
- Whether org-admins occupy a seat: **yes** (a membership row is a seat,
  admin or member — they can practise too).
- Logo bucket public-read vs signed URLs: default **public-read** (logos are
  not sensitive); flip to signed if a customer objects.
- `payments.org_subscription_id` column (flagged in §5) — recommended yes.

---

## 16. Tutor mode

Untimed practice on the existing test scaffolding: each question grades and
reveals its explanation the moment it is committed, then locks.

### Data model

- `tests.mode` (`'exam' | 'tutor'`, text + check, default `'exam'`) — the
  single source of truth for a test's mode. `config.mode` exists only as the
  **assignment prescription input** (§7); the launch route never copies it
  onto the test row.
- `tests.expires_at` is now nullable, CHECK-constrained to be **null exactly
  when mode is tutor**. Tutor sessions never expire: `isExpired` returns
  false on null, so `finalizeIfExpired` is a no-op and an in-progress tutor
  row is resumable indefinitely — no sweep may ever "abandon" one.
- `tests.answered_questions` — written at finalize in both modes;
  completion % = answered/total without an attempts join.
- `test_answers.revealed_at` — the reveal lock. Set once by the reveal
  endpoint, never cleared; a revealed answer is immutable (the autosave
  PATCH skips locked rows).
- `user_mode_stats` view — exam vs tutor accuracy split for the dashboard
  hint. Weak areas, streaks and the headline accuracy stay **combined**.

### The reveal flow

`POST /api/tests/[id]/reveal` takes `{questionId, selectedOptionIds}` (the
body carries the selection so grading never races the autosave), verifies
the caller owns an **in-progress tutor** test — the `mode !== 'tutor'` 400
is a security boundary — then takes the lock (guarded update / insert on
`revealed_at is null`), grades against the frozen `option_order` with the
same `correctOptionsInTest` + `isSelectionCorrect` machinery as finalize,
and upserts the `attempts` row immediately, so streaks and weak areas move
even if the session is never finished. Idempotent: a concurrent reveal gets
the stored outcome back and a differing selection is discarded.

### The withholding-rule exception

"Correctness never reaches the browser mid-test" gains its ONE sanctioned
exception: `getTakeState` re-serves reveal data (correct options,
explanation, the graded selection from `attempts`) for questions of a
**tutor** test that are **already revealed**, so resume reopens them in
their locked explanation state. The gate lives at the top of
`loadRevealData` (lib/tests.ts); exam tests always get `reveal: null`.

### Scoring & lifecycle

- Score = **correct/answered** (`scoreTutorTest`, lib/scoring.ts), not
  correct/total — Finish with unchecked questions is allowed and blanks
  don't count against the user. Completion (answered/total) is reported
  alongside the score on results, history and org reports. `tests.score`
  therefore means % of total for exam rows and % of answered for tutor rows;
  never average it across modes.
- Tutor finalize writes attempts **only for revealed questions** (the
  exam path writes blanks as wrong — tutor must not, or phantom wrongs
  poison accuracy/weak areas), and grades each from its **attempts row**
  (the reveal-time graded truth — a stale autosave can clobber the staged
  selection, never the attempt), falling back to the locked staged
  selection only to heal a reveal that crashed before its attempts write.
- Billing is identical to exam tests: same entitlement check, same trial
  credit at creation (burned even if the session is never finished).
- Known v1 edge: a member who loses org-bank access mid-session can still
  see reveal data inside their own in-progress tutor test; results/review
  apply `withheldQuestionIds` as usual once finished.
