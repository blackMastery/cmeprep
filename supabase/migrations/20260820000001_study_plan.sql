-- Study plan (SPEC §17): rolling weekly goals per (user, exam), generated
-- lazily on first visit each week from the member's own attempts data and
-- FROZEN for the week — progress is derived at read time, the goals are not.
-- No cron. Org admins never read these tables directly; they see only a
-- derived adherence % computed server-side (lib/plan.ts) on the admin client.
--
-- PERF CONTRACT for the views below (same as 20260817000001_readiness.sql):
-- callers MUST filter on the GROUP BY / DISTINCT ON columns — user_id first,
-- always. An unfiltered select aggregates the entire attempts table.

-- ── study_plan_settings ─────────────────────────────────────
-- Per-user per-exam knobs. sitting_on null = fall back to the org's
-- org_exam_dates row (resolved in lib/plan.ts); the personal date is private
-- and never surfaced to org admins.
create table study_plan_settings (
  user_id uuid not null references profiles (id) on delete cascade,
  exam_id uuid not null references exams (id) on delete cascade,
  intensity text not null default 'standard'
    check (intensity in ('light', 'standard', 'intense')),
  sitting_on date,
  -- Cold-start diagnostic mock dismissed by the student; generation then
  -- falls back to generic targets until enough attempts accrue.
  diagnostic_dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, exam_id)
);

-- ── study_plan_weeks ────────────────────────────────────────
-- One generated week. goals is a versioned doc ({ "v": 1, "goals": [...] })
-- parsed with zod on every read — never trusted as typed. intensity is the
-- snapshot the week was generated under (settings may change mid-week and
-- must not rewrite a frozen plan).
create table study_plan_weeks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  exam_id uuid not null references exams (id) on delete cascade,
  -- Monday of the ISO week, America/Guyana civil date — MUST agree with
  -- mondayOf(guyanaDay(now)) in lib/orgs-core.ts and the views' date_trunc.
  week_start date not null,
  goals jsonb not null,
  intensity text not null
    check (intensity in ('light', 'standard', 'intense')),
  generated_at timestamptz not null default now(),
  -- The lazy-generation race lock: two concurrent first visits upsert with
  -- ignoreDuplicates and both land on the same frozen row.
  unique (user_id, exam_id, week_start)
);

create index study_plan_weeks_user_exam_idx
  on study_plan_weeks (user_id, exam_id, week_start desc);

alter table study_plan_settings enable row level security;
alter table study_plan_weeks enable row level security;

create policy plan_settings_own on study_plan_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy plan_weeks_select_own on study_plan_weeks
  for select to authenticated
  using (user_id = (select auth.uid()));
-- Deliberately NO insert/update/delete policy for clients: weeks are the
-- SERVER's frozen prescription and feed the org-visible adherence metric —
-- a client-writable row would let a member forge both. All writes go
-- through lib/plan.ts on the service role, after the caller is verified.

grant select, insert, update on study_plan_settings to authenticated;
grant select on study_plan_weeks to authenticated;
grant select, insert, update, delete on study_plan_settings to service_role;
grant select, insert, delete on study_plan_weeks to service_role;

-- ── per-session attempts, per user per exam per week ────────
-- Focus-session progress: "did a tutor test put ≥K attempts into subject X
-- this week?" The threshold K lives in lib/plan-core.ts, not here. Inner
-- join on tests: legacy null-test_id attempts can't be "sessions". The
-- week_start expression is copied verbatim from the readiness views so
-- mondayOf agrees.
create view public.user_exam_week_test_subject_attempts
  with (security_invoker = true) as
  select
    t.user_id,
    sp.exam_id,
    (date_trunc('week', a.answered_at at time zone 'America/Guyana'))::date as week_start,
    q.subject_id,
    a.test_id,
    t.mode,
    count(*)::int as attempts
  from attempts a
  join tests t on t.id = a.test_id
  join questions q on q.id = a.question_id
  join subjects s on s.id = q.subject_id
  join specialties sp on sp.id = s.specialty_id
  group by t.user_id, sp.exam_id, week_start, q.subject_id, a.test_id, t.mode;

-- ── latest outcome per question, per user ───────────────────
-- The retry pool = rows with is_correct = false; a correct retry exits the
-- pool automatically because the latest row wins. Published questions only —
-- retired items must never be re-prescribed. PERF CONTRACT addendum: filter
-- eq user_id (the first DISTINCT ON key — that qual pushes down); is_correct
-- applies AFTER the distinct and must never be the only predicate.
create view public.user_question_latest_outcome
  with (security_invoker = true) as
  select distinct on (a.user_id, a.question_id)
    a.user_id,
    sp.exam_id,
    q.subject_id,
    a.question_id,
    a.is_correct,
    a.answered_at
  from attempts a
  join questions q
    on q.id = a.question_id and q.is_published and q.deleted_at is null
  join subjects s on s.id = q.subject_id
  join specialties sp on sp.id = s.specialty_id
  order by a.user_id, a.question_id, a.answered_at desc;

grant select on
  public.user_exam_week_test_subject_attempts,
  public.user_question_latest_outcome
to authenticated, service_role;
