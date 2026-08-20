-- Exam documents: the syllabus, blueprint and related reference material an
-- exam is studied from.
--
-- Until now an exam carried only taxonomy (specialties → subjects →
-- questions), so the one thing every candidate asks for first — "where is the
-- syllabus?" — had nowhere to live. Admins upload here from
-- /admin/exams/[id]; students read them at /resources.
--
-- Access is a PAID benefit, and that rule is NOT expressible here: it depends
-- on the org grace window and the trial/paid distinction that
-- lib/entitlements-core.ts owns. So this table is deny-all to client roles and
-- every read goes through a server path that has already run
-- canAccessExam(examDocumentAccessFor(...)). See §5 of the plan.

create table exam_documents (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams on delete cascade,
  title text not null check (char_length(title) between 2 and 140),
  description text not null default '',
  -- Storage object path in the exam-documents bucket; served via signed URLs.
  -- Always non-null: the row is only inserted after the upload is confirmed,
  -- so a row existing means the object exists (the course_lessons stance).
  file_path text not null,
  -- Original filename, used as the `download` name on the signed URL so a
  -- student gets "Syllabus 2026.pdf" rather than the uuid the object is
  -- stored under.
  file_name text not null,
  file_size bigint not null,
  content_type text not null,
  -- Reserved for a future reorder UI. No unique constraint, and gaps are
  -- fine: reads sort (position, created_at desc), like the taxonomy levels.
  position int not null default 0,
  -- Default true: uploading a syllabus is the act of publishing it. The flag
  -- exists so an admin can pull one back without deleting it.
  is_published boolean not null default true,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz
);

-- Partial: every read path filters deleted_at is null.
create index exam_documents_exam_idx
  on exam_documents (exam_id) where deleted_at is null;

-- ── RLS: deny-all for client roles ──────────────────────────
-- No policies at all, as with the tutor tables. Nothing in a browser session
-- ever selects this table — /resources is a Server Component and the download
-- is a route handler — so there is no policy here to drift out of step with
-- the entitlement rule in lib/entitlements-core.ts.
alter table exam_documents enable row level security;

revoke all on public.exam_documents from anon, authenticated;

-- Explicit privileges (see 20260718000004): that migration's
-- `grant ... on all tables` was a snapshot taken on 2026-07-18, so tables
-- created later get nothing — service_role included.
grant select, insert, update, delete on public.exam_documents to service_role;

-- ── exam-documents bucket ───────────────────────────────────
-- Created by migration as well as config.toml so it applies to a hosted
-- project; `on conflict do update` reconciles the two mechanisms.
--
-- PRIVATE, like course-content and unlike question-images: these are the
-- client's licensed syllabus documents and the whole point of the feature is
-- that only paying candidates read them. A public bucket would make the paid
-- gate cosmetic — anyone with the URL would have the file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exam-documents',
  'exam-documents',
  false,
  52428800, -- 50 MiB, matching the course PDF ceiling
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Admin-only, the course-content shape. Students never touch the bucket with
-- their own credentials: the download route mints a short-lived signed URL
-- over the service-role client after the paid gate passes.
--
-- Note: RLS is already enabled on storage.objects, and on hosted projects the
-- table is owned by supabase_storage_admin — do not try to alter it here.
create policy "exam_documents_admin_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'exam-documents' and public.is_admin());

create policy "exam_documents_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'exam-documents' and public.is_admin());

create policy "exam_documents_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'exam-documents' and public.is_admin())
  with check (bucket_id = 'exam-documents' and public.is_admin());

create policy "exam_documents_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'exam-documents' and public.is_admin());
