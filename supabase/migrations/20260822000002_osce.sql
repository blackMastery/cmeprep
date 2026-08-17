-- OSCE part 2/2: open-ended stations graded by an LLM judge (SPEC: OSCE v1).
-- A question of type 'osce' is a vignette stem + one open question + one
-- admin-authored model answer. The student types free text; the grade route
-- sends stem + model answer + answer to OpenAI and records a BINARY verdict
-- straight into attempts.is_correct, so accuracy/weak areas/streaks include
-- OSCE with zero new stats plumbing.

-- ── tests.mode: add 'osce' ──────────────────────────────────
-- The one-line check swap the tutor_mode migration promised. OSCE sessions
-- are untimed like tutor (resumable indefinitely, isExpired false on null).
alter table tests drop constraint tests_mode_check;
alter table tests add constraint tests_mode_check
  check (mode in ('exam', 'tutor', 'osce'));
alter table tests drop constraint tests_expires_at_by_mode;
alter table tests add constraint tests_expires_at_by_mode check (
  (mode in ('tutor', 'osce') and expires_at is null)
  or (mode = 'exam' and expires_at is not null)
);

-- ── free-text answers ───────────────────────────────────────
-- Staged text mirrors selected_option_ids' role for MCQs; the attempts copy
-- exists because review/results read ONLY attempts (never test_answers), and
-- the graded text must be as immutable as the verdict it earned.
alter table test_answers add column answer_text text;
alter table attempts add column answer_text text;

-- ── model answers ───────────────────────────────────────────
-- NOT a column on questions: published questions rows are client-readable
-- (SELECT policy + column grants), so a model_answer column would hand every
-- student the answer key mid-test. Same hard-revoked posture as
-- question_options — reads happen only in server libs via the admin client.
create table question_model_answers (
  question_id uuid primary key references questions on delete cascade,
  model_answer text not null
    check (char_length(model_answer) between 1 and 10000),
  updated_at timestamptz not null default now()
);
alter table question_model_answers enable row level security;
revoke all on public.question_model_answers from anon, authenticated;
grant select, insert, update, delete
  on public.question_model_answers to service_role;

-- ── grading audit log ───────────────────────────────────────
-- One row per OpenAI call, INCLUDING failures (verdict null + error set).
-- Triple duty: spend tracking (tokens), dispute forensics (raw_response —
-- the AI's prose is never shown to students, it lives only here), and the
-- daily-cap counter (count verdict-not-null rows in the Guyana day; failed
-- calls deliberately don't burn cap because the student is told to retry).
create table osce_grading_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles,
  -- SET NULL, not CASCADE: spend history must survive test deletion.
  test_id uuid references tests on delete set null,
  question_id uuid not null references questions,
  answer_text text not null,
  verdict text check (verdict in ('correct', 'incorrect')),
  model text not null,
  prompt_tokens int,
  completion_tokens int,
  duration_ms int not null,
  error text,
  raw_response jsonb,
  created_at timestamptz not null default now()
);
-- The cap query: user + created_at range scan.
create index osce_grading_events_user_day_idx
  on osce_grading_events (user_id, created_at);
alter table osce_grading_events enable row level security;
revoke all on public.osce_grading_events from anon, authenticated;
grant select, insert, update, delete
  on public.osce_grading_events to service_role;

-- ── grade dispute flags ─────────────────────────────────────
-- "Report this grade": signal for admins to fix bad model answers. No
-- regrade mechanics — the verdict stands. One report per station per user.
create table osce_grade_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles,
  test_id uuid not null references tests on delete cascade,
  question_id uuid not null references questions,
  grading_event_id uuid references osce_grading_events on delete set null,
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references profiles on delete set null,
  unique (user_id, test_id, question_id)
);
alter table osce_grade_reports enable row level security;
revoke all on public.osce_grade_reports from anon, authenticated;
grant select, insert, update, delete
  on public.osce_grade_reports to service_role;

-- ── wizard counts ───────────────────────────────────────────
-- Published OSCE stations per subject; the new-test wizard only offers the
-- OSCE mode where these exist. Uses the enum value added in part 1/2.
create view public.subject_osce_question_counts
  with (security_invoker = true) as
  select
    subject_id,
    count(*)::int as question_count
  from questions
  where is_published and deleted_at is null and type = 'osce'
  group by subject_id;

grant select on public.subject_osce_question_counts to authenticated, service_role;

-- ── MCQ-only counts for MCQ launch paths ────────────────────
-- exam_subject_counts.question_count now includes OSCE stations, but study-
-- plan generation and mock/focus launches deal only non-OSCE questions
-- (creation filters .neq type 'osce') — sizing a session against the
-- inclusive count would freeze plan goals that can never be met. CREATE OR
-- REPLACE appends the column, so readiness keeps the inclusive count it had.
create or replace view public.exam_subject_counts
  with (security_invoker = true) as
  select
    sp.exam_id,
    s.id as subject_id,
    s.name as subject_name,
    (count(q.id) filter (where q.is_published and q.deleted_at is null))::int as question_count,
    (count(q.id) filter (where q.is_published and q.deleted_at is null
                           and q.type <> 'osce'))::int as mcq_question_count
  from subjects s
  join specialties sp on sp.id = s.specialty_id
  left join questions q on q.subject_id = s.id
  group by sp.exam_id, s.id, s.name;

-- Buyer-facing/wizard counts now describe the MCQ bank the wizard's exam and
-- tutor modes actually deal — an exam advertising 45 questions must not
-- silently deal a 30-question paper. OSCE stations have their own count above.
create or replace view public.subject_question_counts
  with (security_invoker = true) as
  select
    subject_id,
    count(*)::int as question_count
  from questions
  where is_published and deleted_at is null and type <> 'osce'
  group by subject_id;
