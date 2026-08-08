-- Storage bucket for uploaded bulk-import workbooks.
--
-- Same rationale as ..._storage_question_images.sql: created by migration
-- rather than only in config.toml so it applies to a hosted project too, and
-- `on conflict do update` reconciles a bucket the local CLI may already have
-- created from config.toml.
--
-- Why the workbook goes to Storage at all: an .xlsx carrying embedded
-- pictures blows past the ~4.5 MB serverless request-body limit after about
-- ten images. The wizard uploads it straight to Storage with a signed URL and
-- then hands preview/commit only an object path, so the bytes never traverse
-- a Next route — the same trick components/admin/image-upload.tsx uses.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'question-imports',
  'question-imports',
  false,
  26214400, -- 25 MiB
  array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- PRIVATE, unlike question-images. Nothing but the server ever reads these,
-- and a workbook is admin-authored content that has not been reviewed yet —
-- there is no reason for it to be fetchable by URL. Commit deletes the object
-- once it has finished with it; anything left behind is an abandoned preview.
--
-- Note: RLS is already enabled on storage.objects, and on hosted projects the
-- table is owned by supabase_storage_admin — do not try to alter it here.

create policy "question_imports_admin_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'question-imports' and public.is_admin());

create policy "question_imports_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'question-imports' and public.is_admin());

create policy "question_imports_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'question-imports' and public.is_admin())
  with check (bucket_id = 'question-imports' and public.is_admin());

create policy "question_imports_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'question-imports' and public.is_admin());
