-- Exam-scoped subscriptions.
--
-- A plan no longer buys the whole catalogue: a purchase names ONE exam, and
-- access is separate per exam. Buying exam A then exam B leaves two live rows
-- with two independent end dates; re-buying the SAME exam extends that exam's
-- period (see activePeriodEndForExam in lib/subscriptions.ts).

-- ── subscriptions: scope, a real plan key, and an edit timestamp ──
alter table subscriptions
  -- NULL means ALL-ACCESS. That is not a placeholder for "unset" — it is the
  -- grandfather clause. Every row that exists today was sold under blanket
  -- terms, so leaving them NULL is what stops anyone who already paid from
  -- losing access. Admin comp grants keep the NULL option for the same reason.
  --
  -- on delete RESTRICT, deliberately, NOT `set null`: `set null` would turn
  -- every scoped subscription into an all-access one the moment an admin
  -- deleted an exam — a silent privilege escalation. RESTRICT instead makes an
  -- exam that has ever been sold undeletable, which is the correct posture for
  -- a financial record, and mirrors subjects → specialties in 20260721000001.
  add column exam_id uuid references exams on delete restrict,

  -- `plan` stays a text NAME SNAPSHOT so history survives plan renames and
  -- hard deletes, but a name is a poor key: the admin card matched presets by
  -- name, which silently degrades every historical row to "Custom…" the first
  -- time a plan is renamed. A nullable FK gives us a real key for preset
  -- matching and for "renew this plan for this exam" links, while the snapshot
  -- keeps doing the display job. `on delete set null` because plan hard delete
  -- is supported and must stay supported.
  add column plan_id uuid references plans on delete set null,

  -- The table had no updated_at, so admin edits left no timestamp. Every other
  -- mutable table here carries one.
  add column updated_at timestamptz;

-- There was no index on subscriptions at all beyond the pk/unique. The
-- entitlement read ("every row for this user") now runs on each test creation.
create index subscriptions_user_idx
  on subscriptions (user_id, current_period_end desc);

-- Hot path for per-exam stacking: "the live row for THIS user and THIS exam".
-- Partial on status so the index stays small as expired rows accumulate.
create index subscriptions_user_exam_active_idx
  on subscriptions (user_id, exam_id, current_period_end desc)
  where status = 'active';

comment on column subscriptions.exam_id is
  'Exam this subscription entitles. NULL = all-access (grandfathered legacy rows + admin comp grants).';
comment on column subscriptions.plan_id is
  'Soft link to plans; NULL for bespoke admin grants and deleted plans. Display uses the `plan` text snapshot.';

-- No backfill, on purpose: existing rows stay NULL = all-access. Pointing them
-- at a specific exam would revoke access people have already paid for.

-- RLS and grants are untouched: subscriptions_select_own (20260718000003) is
-- column-agnostic, and 20260718000004 grants at table level, so the new
-- columns are already covered.

-- ── Buyer-facing question counts ────────────────────────────
-- The checkout picker advertises how many questions an exam holds, so the
-- count must be PUBLISHED-only. Two reasons this needs its own view rather
-- than a count off `questions`:
--   1. lib/admin/taxonomy.ts counts unpublished questions (right for admin,
--      wrong for a buyer).
--   2. the questions RLS policy is `(is_published and deleted_at is null) or
--      public.is_admin()`, so an admin previewing checkout through the RLS
--      client would otherwise see inflated numbers.
-- The WHERE below pins it for every reader; security_invoker keeps the
-- underlying policy in force rather than running as the view owner.
create view public.topic_question_counts
  with (security_invoker = true) as
  select
    topic_id,
    count(*)::int as question_count
  from questions
  where is_published and deleted_at is null
  group by topic_id;

-- 0004's blanket service_role grant only covered objects existing then, so
-- both roles are named explicitly — same pattern as 20260721000001/2.
grant select on public.topic_question_counts to authenticated, service_role;
