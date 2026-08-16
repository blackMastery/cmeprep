-- Courses (course-spec.md): admin-authored learning content — ordered modules
-- of video / image / text / pdf / quiz lessons, free for every signed-in
-- user. Standalone catalog: deliberately NOT attached to exams/specialties.
--
-- Progression is quiz-gated (module N unlocks when every quiz in modules
-- 1..N-1 has a passing attempt). That rule lives in lib/courses-core.ts and
-- is enforced by the server read/write paths, not here — RLS's job is only:
--   1. drafts are invisible to non-admins,
--   2. quiz correctness never reaches a browser session,
--   3. learners read only their own progress/attempts.

-- ── content tables ──────────────────────────────────────────
create table courses (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 140),
  description text not null default '',
  -- Storage object path in the course-content bucket; served via signed URLs.
  cover_path text,
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz
);

create table course_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 140),
  -- Gaps are fine; ordering is (position, id). No unique constraint — reorder
  -- rewrites positions row-by-row like plans/exams and must not trip mid-way.
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz
);

create index course_modules_course_idx on course_modules (course_id);

create table course_lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references course_modules (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 140),
  kind text not null check (kind in ('video', 'image', 'text', 'pdf', 'quiz')),
  position int not null default 0,
  -- kind='text': the content itself; other kinds: optional intro shown above
  -- the media / quiz. Markdown, rendered sanitised (no raw HTML).
  body_md text,
  -- Storage object path; only meaningful for file-backed kinds. Stamped by
  -- the upload-confirm action, so a non-null value means the object exists.
  file_path text,
  file_size bigint,
  -- Quiz pass threshold (%). App-side default is 70 on quiz creation.
  pass_pct int,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz,
  check (pass_pct between 1 and 100),
  check (kind = 'quiz' or pass_pct is null),
  check (kind in ('video', 'image', 'pdf') or file_path is null)
);

create index course_lessons_module_idx on course_lessons (module_id);

create table course_questions (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references course_lessons (id) on delete cascade,
  prompt_md text not null,
  -- Readable pre-attempt via RLS, same stance as questions.explanation: the
  -- quiz is formative with unlimited retakes, so an eager reader spoils only
  -- themselves. Only is_correct is a secret (view below).
  explanation_md text not null default '',
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz
);

create index course_questions_lesson_idx on course_questions (lesson_id);

create table course_question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references course_questions (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 500),
  is_correct boolean not null default false,
  position int not null default 0,
  -- Retire, never DELETE (question_options precedent): attempts snapshot
  -- option ids in jsonb, and a hard delete would leave history dangling.
  deleted_at timestamptz
  -- Exactly one is_correct per question (single-best-answer v1) is enforced
  -- in the action layer, like the exam bank's multi/single rules.
);

create index course_question_options_question_idx
  on course_question_options (question_id);

-- ── learner state ───────────────────────────────────────────
-- One row per completed (user, lesson). Content lessons: the mark-complete
-- action. Quiz lessons: inserted by grading on a passing attempt, so
-- completion queries never special-case quizzes.
create table course_lesson_progress (
  user_id uuid not null references profiles (id) on delete cascade,
  lesson_id uuid not null references course_lessons (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

-- Immutable, append-only. `answers` snapshots the graded picks
-- ([{question_id, option_id, correct}]) so later question edits never
-- rewrite history.
create table course_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  lesson_id uuid not null references course_lessons (id) on delete cascade,
  score_pct int not null check (score_pct between 0 and 100),
  passed boolean not null,
  answers jsonb not null,
  created_at timestamptz not null default now()
);

create index course_quiz_attempts_user_lesson_idx
  on course_quiz_attempts (user_id, lesson_id);

-- ── visibility helpers ──────────────────────────────────────
-- SECURITY DEFINER like is_org_member(): child-table policies need the
-- parent chain without stacking nested RLS evaluation per row. is_admin()
-- keeps draft courses previewable through the LEARNER pages for admins —
-- the builder itself reads via the service-role client.
create function public.course_is_visible(course uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.courses c
    where c.id = course
      and c.deleted_at is null
      and (c.status = 'published' or public.is_admin())
  );
$$;

create function public.course_lesson_visible(lesson uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.course_lessons l
    join public.course_modules m on m.id = l.module_id
    where l.id = lesson
      and l.deleted_at is null
      and m.deleted_at is null
      and public.course_is_visible(m.course_id)
  );
$$;

revoke execute on function public.course_is_visible(uuid) from anon;
revoke execute on function public.course_lesson_visible(uuid) from anon;
grant execute on function public.course_is_visible(uuid) to authenticated;
grant execute on function public.course_lesson_visible(uuid) to authenticated;

-- ── RLS ─────────────────────────────────────────────────────
alter table courses enable row level security;
alter table course_modules enable row level security;
alter table course_lessons enable row level security;
alter table course_questions enable row level security;
alter table course_question_options enable row level security;
alter table course_lesson_progress enable row level security;
alter table course_quiz_attempts enable row level security;

create policy courses_select on courses
  for select to authenticated
  using (deleted_at is null and (status = 'published' or public.is_admin()));

create policy course_modules_select on course_modules
  for select to authenticated
  using (deleted_at is null and public.course_is_visible(course_id));

create policy course_lessons_select on course_lessons
  for select to authenticated
  using (public.course_lesson_visible(id));

create policy course_questions_select on course_questions
  for select to authenticated
  using (deleted_at is null and public.course_lesson_visible(lesson_id));

-- is_correct MUST NOT leak: hard-revoke the base table for client roles
-- (grants section below) and expose the definer view instead, exactly like
-- question_options / question_options_public.
create view public.course_question_options_public
  with (security_invoker = false, security_barrier = true) as
  select o.id, o.question_id, o.label, o.position
  from public.course_question_options o
  join public.course_questions q on q.id = o.question_id
  where o.deleted_at is null
    and q.deleted_at is null
    and public.course_lesson_visible(q.lesson_id);

-- Learners read only their own state. No insert/update/delete policies:
-- writes go through server actions on the service-role client, which also
-- enforce the unlock rule (a client-side insert could otherwise mark a
-- locked lesson complete).
create policy course_lesson_progress_select_own on course_lesson_progress
  for select to authenticated
  using (user_id = auth.uid());

create policy course_quiz_attempts_select_own on course_quiz_attempts
  for select to authenticated
  using (user_id = auth.uid());

-- ── grants ──────────────────────────────────────────────────
-- Explicit privileges (see 20260718000004): postgres-created tables default
-- to no DML for these roles, service_role included.
grant select, insert, update, delete on
  public.courses,
  public.course_modules,
  public.course_lessons,
  public.course_questions,
  public.course_question_options,
  public.course_lesson_progress,
  public.course_quiz_attempts
to service_role;

grant select on
  public.courses,
  public.course_modules,
  public.course_lessons,
  public.course_questions,
  public.course_lesson_progress,
  public.course_quiz_attempts
to authenticated;

revoke all on public.course_question_options from anon, authenticated;

revoke all on public.course_question_options_public from anon, authenticated;
grant select on public.course_question_options_public to authenticated;

-- ── storage bucket ──────────────────────────────────────────
-- PRIVATE: courses are free but files are served via short-lived signed URLs
-- minted after requireUser() + the unlock check — a public bucket would make
-- every video/PDF a permanent shareable link. Mirrored in config.toml for
-- the local stack; `on conflict do update` reconciles the two.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'course-content',
  'course-content',
  false,
  524288000, -- 500 MiB (video ceiling; per-kind caps are app-side)
  array['video/mp4', 'image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Note: RLS is already enabled on storage.objects, and on hosted projects the
-- table is owned by supabase_storage_admin — do not try to alter it here.

create policy "course_content_admin_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'course-content' and public.is_admin());

create policy "course_content_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'course-content' and public.is_admin());

create policy "course_content_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'course-content' and public.is_admin())
  with check (bucket_id = 'course-content' and public.is_admin());

create policy "course_content_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'course-content' and public.is_admin());
