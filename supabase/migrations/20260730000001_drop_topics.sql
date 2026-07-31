-- Collapse Topic into Subject: questions hang directly on subjects.
-- Hierarchy becomes Exam → Specialty → Subject → Question → Options.

-- ── 1. Add subject_id and backfill from topics (all rows, incl. soft-deleted) ─
alter table public.questions
  add column subject_id uuid references public.subjects on delete restrict;

update public.questions q
set subject_id = t.subject_id
from public.topics t
where t.id = q.topic_id;

alter table public.questions
  alter column subject_id set not null;

-- ── 2. Drop topic-keyed views before dropping topic_id / topics ──────────────
drop view if exists public.topic_accuracy;
drop view if exists public.topic_question_counts;

-- ── 3. Drop topic_id and the topics table ────────────────────────────────────
drop index if exists public.questions_topic_idx;
alter table public.questions drop column topic_id;
drop table public.topics;

create index questions_subject_idx
  on public.questions (subject_id)
  where deleted_at is null;

-- ── 4. Subject-level analytics (replaces topic_accuracy) ─────────────────────
create view public.subject_accuracy
  with (security_invoker = true) as
  select
    a.user_id,
    s.id as subject_id,
    s.name as subject_name,
    sp.id as specialty_id,
    sp.name as specialty_name,
    e.id as exam_id,
    e.name as exam_name,
    count(*)::int as attempts,
    (count(*) filter (where a.is_correct))::int as correct,
    round(100.0 * (count(*) filter (where a.is_correct)) / count(*), 1) as accuracy_pct
  from attempts a
  join questions q on q.id = a.question_id
  join subjects s on s.id = q.subject_id
  join specialties sp on sp.id = s.specialty_id
  join exams e on e.id = sp.exam_id
  group by a.user_id, s.id, s.name, sp.id, sp.name, e.id, e.name;

-- ── 5. Published question counts per subject (replaces topic_question_counts) ─
create view public.subject_question_counts
  with (security_invoker = true) as
  select
    subject_id,
    count(*)::int as question_count
  from questions
  where is_published and deleted_at is null
  group by subject_id;

grant select on public.subject_accuracy to authenticated, service_role;
grant select on public.subject_question_counts to authenticated, service_role;
