-- Exam readiness (SPEC §8 v2): a per-member per-exam readiness score replaces
-- the binary risk flag. Compute stays read-time (no snapshots/cron); the
-- date-bucketed aggregation the score needs moves into SQL here.
--
-- PERF CONTRACT for every view below: callers MUST filter on the GROUP BY
-- columns (user_id / exam_id / week_start >=) — the predicates push below the
-- aggregate onto attempts (user_id, answered_at). An unfiltered select
-- aggregates the entire attempts table.

-- ── org_exam_dates ──────────────────────────────────────────
-- Optional sitting date per org per entitled exam. FRAMING ONLY: it drives
-- days-remaining copy and sort priority, never the score or bands.
create table org_exam_dates (
  org_id uuid not null references orgs (id) on delete cascade,
  exam_id uuid not null references exams (id) on delete cascade,
  sitting_on date not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, exam_id)
);

alter table org_exam_dates enable row level security;

-- Members read their org's dates (the member readiness card shows "X days
-- to your sitting"); all writes are server actions on the admin client after
-- requireOrgAdmin(), like every other org table — no client write policy.
create policy org_exam_dates_select on org_exam_dates
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_admin());

grant select on org_exam_dates to authenticated;
grant select, insert, update, delete on org_exam_dates to service_role;

-- ── weekly accuracy by mode, per user per exam ──────────────
-- Feeds the blended accuracy, trend halves and the sparkline. Weeks bucket in
-- America/Guyana (matching user_daily_activity) and date_trunc('week') is
-- Monday-start — the JS window helper (startOfIsoWeek, lib/orgs-core.ts) must
-- agree or .gte("week_start") clips a partial week. Legacy attempts with
-- test_id null count as 'exam' via coalesce, same as user_mode_stats — but
-- they can never satisfy the timed-mock cap, which keys off completed
-- exam-mode tests rows, not attempts.
create view public.user_exam_weekly_mode_accuracy
  with (security_invoker = true) as
  select
    a.user_id,
    sp.exam_id,
    (date_trunc('week', a.answered_at at time zone 'America/Guyana'))::date as week_start,
    coalesce(t.mode, 'exam') as mode,
    count(*)::int as attempts,
    (count(*) filter (where a.is_correct))::int as correct,
    coalesce(sum(a.time_spent_sec) filter (where a.time_spent_sec is not null), 0)::int as time_spent_sec,
    (count(*) filter (where a.time_spent_sec is not null))::int as timed_attempts
  from attempts a
  join questions q on q.id = a.question_id
  join subjects s on s.id = q.subject_id
  join specialties sp on sp.id = s.specialty_id
  left join tests t on t.id = a.test_id
  group by a.user_id, sp.exam_id, week_start, coalesce(t.mode, 'exam');

-- ── weekly distinct active days, per user per exam ──────────
-- Cadence. Separate from the view above because distinct days must dedupe
-- ACROSS modes.
create view public.user_exam_weekly_activity
  with (security_invoker = true) as
  select
    a.user_id,
    sp.exam_id,
    (date_trunc('week', a.answered_at at time zone 'America/Guyana'))::date as week_start,
    count(distinct (a.answered_at at time zone 'America/Guyana')::date)::int as active_days
  from attempts a
  join questions q on q.id = a.question_id
  join subjects s on s.id = q.subject_id
  join specialties sp on sp.id = s.specialty_id
  group by a.user_id, sp.exam_id, week_start;

-- ── all-time totals, per user per exam ──────────────────────
-- Cold-start fallback + per-exam last-active day. Replaces the org side of
-- user_daily_activity, whose global row limit silently truncated long
-- histories; rows here are bounded by members × exams.
create view public.user_exam_stats
  with (security_invoker = true) as
  select
    a.user_id,
    sp.exam_id,
    count(*)::int as attempts,
    (count(*) filter (where a.is_correct))::int as correct,
    max((a.answered_at at time zone 'America/Guyana')::date) as last_active_day
  from attempts a
  join questions q on q.id = a.question_id
  join subjects s on s.id = q.subject_id
  join specialties sp on sp.id = s.specialty_id
  group by a.user_id, sp.exam_id;

-- ── exam subject roster with published counts ───────────────
-- Coverage denominator: EVERY subject of the exam, touched or not, with its
-- published question count (subject_question_counts lacks exam_id).
create view public.exam_subject_counts
  with (security_invoker = true) as
  select
    sp.exam_id,
    s.id as subject_id,
    s.name as subject_name,
    (count(q.id) filter (where q.is_published and q.deleted_at is null))::int as question_count
  from subjects s
  join specialties sp on sp.id = s.specialty_id
  left join questions q on q.subject_id = s.id
  group by sp.exam_id, s.id, s.name;

grant select on
  public.user_exam_weekly_mode_accuracy,
  public.user_exam_weekly_activity,
  public.user_exam_stats,
  public.exam_subject_counts
to authenticated, service_role;
