-- Visual ingestion: figures, diagrams and tables from the study materials.
--
-- Before this, ingestion was text-only — a PDF's figures, vector diagrams and
-- table structure were dropped, and a scanned file indexed nothing at all.
-- Now each visual gets (a) a text description, stored as an ordinary chunk so
-- it retrieves through the existing lanes, and (b) the image itself in Storage,
-- linked from that chunk so the tutor can show it and the model can look at it.

-- ── file_assets: one row per stored image ───────────────────
create table file_assets (
  id text primary key,                   -- sha1(file_id:content_hash:page)
  file_id text not null references synced_files on delete cascade,
  content_hash text not null,            -- sha256 of the image bytes
  page int,                              -- source page/slide, null for docx
  kind text not null check (kind in ('figure', 'page')),
  storage_path text not null,
  public_url text not null,
  width int,
  height int,
  created_at timestamptz not null default now()
);
create index file_assets_file_idx on file_assets (file_id);
create index file_assets_hash_idx on file_assets (content_hash);

-- ── asset_descriptions: the vision-model cache ──────────────
-- Keyed by image bytes, not by asset, so the model is called once per distinct
-- image ever: a logo repeated across 80 pages costs one call, and re-ingesting
-- an unchanged file costs none. Deliberately never garbage-collected — it is a
-- content-addressed cache, and keeping it is the whole point.
create table asset_descriptions (
  content_hash text primary key,
  description text not null,
  model text,
  created_at timestamptz not null default now()
);

-- ── chunks: link a description back to its image ────────────
alter table chunks add column asset_id text references file_assets on delete set null;
alter table chunks add column kind text not null default 'text'
  check (kind in ('text', 'figure', 'table'));
create index chunks_asset_idx on chunks (asset_id);

-- ── RLS: deny-all for client roles, as with the other tutor tables ──
alter table file_assets enable row level security;
alter table asset_descriptions enable row level security;

revoke all on public.file_assets from anon, authenticated;
revoke all on public.asset_descriptions from anon, authenticated;

-- ── study-images bucket ─────────────────────────────────────
-- Created by migration as well as config.toml so it applies to a hosted
-- project; `on conflict do update` reconciles the two mechanisms.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'study-images',
  'study-images',
  true,
  10485760, -- 10 MiB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Public read follows the question-images precedent, but the trade-off is not
-- identical and is worth stating plainly: this bucket holds crops of the
-- client's licensed course material, so a direct link exposes study content
-- rather than a standalone clinical illustration. What makes it acceptable is
-- that paths are content-hash based (unguessable, and not enumerable without
-- select on storage.objects, which anon does not have), and that no correctness
-- invariant depends on it — the answer never lives only in the image. If the
-- client objects, moving to signed URLs is contained: app/storage.py, the
-- select in app/retrieval.py, and citations_payload in app/prompts.py.
create policy "study_images_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'study-images');

-- Writes come from the ingest pipeline over the service key, which bypasses
-- RLS; these exist so an admin can fix an asset by hand from the client.
create policy "study_images_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'study-images' and public.is_admin());

create policy "study_images_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'study-images' and public.is_admin())
  with check (bucket_id = 'study-images' and public.is_admin());

create policy "study_images_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'study-images' and public.is_admin());
