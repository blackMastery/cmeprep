-- CME certificates of completion.
--
-- A certificate is a COMPLETION record, not a CME credit claim: cmeprep is
-- not an accredited provider, so nothing here stores credit hours, an
-- accrediting body or an activity type, and the rendered PDF says so.
--
-- Why a table at all, when completion is derived on read (courseCompletion()
-- in lib/courses-core.ts)? Because derived completion is not stable: an admin
-- adding one lesson silently drops every past completer below 100%. A
-- certificate that evaporates when the syllabus grows is worse than none, so
-- issuance is a one-time write and the row snapshots what the course said at
-- the time.

-- The professional name printed on certificates. Deliberately NOT full_name:
-- that one feeds greetings via lib/names.ts firstName(), so "Dr. Jane Smith,
-- MBBS" there would produce "Hi, Dr.". Nullable — the vast majority of users
-- never finish a course and must never be asked for it.
alter table profiles add column credential_name text
  check (
    credential_name is null
    or char_length(btrim(credential_name)) between 2 and 80
  );

-- Mirrors `grant update (full_name)` in 20260718000004: the column-level
-- grant plus the existing profiles_update_own policy is what lets a learner
-- correct their own name through the RLS client. Anything not listed here
-- stays unwritable by `authenticated` no matter what a payload contains.
grant update (credential_name) on public.profiles to authenticated;

create table course_certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  -- No `on delete cascade`: courses are only ever SOFT-deleted (deleted_at),
  -- so a real delete would mean the course row is gone for good — and the
  -- certificate must outlive that, which is what course_title is for.
  course_id uuid not null references courses (id),
  -- The public verification handle. Opaque and high-entropy on purpose: it
  -- is printed on a document people hand to employers, so it must not be the
  -- row id (which would leak insertion order and be walkable).
  code text not null unique,
  -- ── snapshots ─────────────────────────────────────────────
  -- Frozen so a rename, unpublish or soft-delete can never alter or retract
  -- an issued certificate. The learner's NAME is deliberately not snapshotted
  -- here: it is read live from profiles.credential_name so a typo fix
  -- propagates to every certificate while the codes stay stable.
  course_title text not null,
  -- Evidentiary only — how big the course was at issue. Never printed: the
  -- certificate claims completion, not effort.
  lesson_count int not null check (lesson_count > 0),
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- One certificate per learner per course. This constraint IS the
  -- idempotency guard: both learner write paths (mark complete, quiz pass)
  -- attempt a mint and can race on the final lesson.
  unique (user_id, course_id)
);

create index course_certificates_user_idx
  on course_certificates (user_id, issued_at desc);

alter table course_certificates enable row level security;

-- Learners read their own. No anon policy on purpose: the public /verify
-- page reads through the service-role client and returns three fields, so
-- the table itself is never exposed to an unauthenticated session.
create policy course_certificates_select_own on course_certificates
  for select to authenticated
  using (user_id = auth.uid());

-- Explicit privileges (see 20260718000004): postgres-created tables default
-- to no DML for these roles, service_role included.
grant select, insert on public.course_certificates to service_role;
grant select on public.course_certificates to authenticated;
