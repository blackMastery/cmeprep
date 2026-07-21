-- Exam → Specialty above the existing Subject → Topic hierarchy.
-- Backfills a default Exam/Specialty (fixed ids, mirrored in
-- lib/taxonomy-defaults.ts) and attaches every existing subject to it,
-- then swaps subjects' global name-unique for unique-per-specialty.

-- ── Tables ──────────────────────────────────────────────────
create table exams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table specialties (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (exam_id, name)
);
create index specialties_exam_idx on specialties (exam_id);

-- ── Default rows (hosted project has live data; fixed ids on purpose) ──
insert into exams (id, name, position) values
  ('e0000000-0000-0000-0000-000000000001', 'Medical Board Exam', 0);
insert into specialties (id, exam_id, name, position) values
  ('5c000000-0000-0000-0000-000000000001',
   'e0000000-0000-0000-0000-000000000001', 'General', 0);

-- ── subjects.specialty_id: add → backfill → not null ───────
-- on delete restrict (belt) even though the specialty delete action
-- pre-flights in code (braces) — same pattern as questions→topics.
alter table subjects
  add column specialty_id uuid references specialties on delete restrict;
update subjects
  set specialty_id = '5c000000-0000-0000-0000-000000000001';
alter table subjects alter column specialty_id set not null;
create index subjects_specialty_idx on subjects (specialty_id);

-- Subject names become unique per specialty, not globally.
alter table subjects drop constraint subjects_name_key;
alter table subjects add constraint subjects_specialty_id_name_key
  unique (specialty_id, name);

-- ── RLS: mirror the per-table pattern exactly ───────────────
alter table exams enable row level security;
create policy exams_select on exams
  for select to authenticated using (true);
create policy exams_admin_write on exams
  for all using (public.is_admin()) with check (public.is_admin());

alter table specialties enable row level security;
create policy specialties_select on specialties
  for select to authenticated using (true);
create policy specialties_admin_write on specialties
  for all using (public.is_admin()) with check (public.is_admin());

-- ── Grants: 0004's blanket grant only covered tables existing then ──
grant select, insert, update, delete on public.exams, public.specialties
  to service_role;
grant select on public.exams, public.specialties to authenticated;

-- ── topic_accuracy: extend with specialty/exam (drop → recreate) ──
drop view public.topic_accuracy;
create view public.topic_accuracy
  with (security_invoker = true) as
  select
    a.user_id,
    t.id as topic_id,
    t.name as topic_name,
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
  join topics t on t.id = q.topic_id
  join subjects s on s.id = t.subject_id
  join specialties sp on sp.id = s.specialty_id
  join exams e on e.id = sp.exam_id
  group by a.user_id, t.id, t.name, s.id, s.name, sp.id, sp.name, e.id, e.name;

-- drop view discards the old grant; re-grant.
grant select on public.topic_accuracy to authenticated;
