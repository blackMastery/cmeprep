-- Storage bucket for org logos (SPEC.md §9). Same reconcile-with-config
-- pattern as question-images.
--
-- Public read is deliberate: logos are not sensitive, and signed URLs would
-- churn on every shell render. Writes go through the service-role client
-- after requireOrgAdmin() (signed upload URLs), so the client-role policies
-- below are read-only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-branding',
  'org-branding',
  true,
  2097152, -- 2 MiB — it's a logo
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "org_branding_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'org-branding');
