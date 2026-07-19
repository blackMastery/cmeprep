-- Storage bucket for question images (image_based questions).
--
-- Created by migration rather than only in config.toml so it applies to a
-- hosted project too. `on conflict do update` reconciles a bucket the local
-- CLI may already have created from config.toml, so the two mechanisms
-- agree instead of fighting.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'question-images',
  'question-images',
  true,
  5242880, -- 5 MiB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Public read is deliberate. Signed URLs are the wrong tool here: a paper can
-- run up to 240 minutes and review mode is revisitable indefinitely, so there
-- is no TTL that works. They would also change on every render, defeating
-- next/image caching. The bucket holds clinical illustrations (ECGs, films) —
-- the answer never lives in the image, and paths are uuid-based. The exposure
-- is "someone with a direct link sees an X-ray", not correctness leaking,
-- which is the invariant the rest of the RLS design protects.
--
-- Note: RLS is already enabled on storage.objects, and on hosted projects the
-- table is owned by supabase_storage_admin — do not try to alter it here.

create policy "question_images_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'question-images');

create policy "question_images_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'question-images' and public.is_admin());

create policy "question_images_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'question-images' and public.is_admin())
  with check (bucket_id = 'question-images' and public.is_admin());

create policy "question_images_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'question-images' and public.is_admin());
