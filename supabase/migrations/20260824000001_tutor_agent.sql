-- Tutor Agent — Phase 0 foundations (tutor-agent-development-plan.md §Phase 0)
-- pgvector + ingestion ledger + chunk index + chat audit trail.
-- All three tables are service-role only: the FastAPI tutor service talks to
-- Postgres directly and bypasses RLS. Student-facing read policies (e.g. own
-- chat history) land in Phase 3 with the UI.

create extension if not exists vector with schema extensions;

-- ── synced_files: Drive sync ledger ─────────────────────────
create table synced_files (
  id text primary key,                   -- Google Drive file ID
  name text not null,
  mime_type text not null,
  modified_time timestamptz,
  md5_checksum text,                     -- null for native Google formats
  web_view_link text,
  status text not null default 'synced'
    check (status in ('synced', 'skipped', 'error')),
  error text,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ── chunks: the retrieval index ─────────────────────────────
create table chunks (
  id text primary key,                   -- content hash (stable across re-syncs)
  file_id text not null references synced_files on delete cascade,
  file_name text not null,
  page int,                              -- source page/slide where known
  section text,                          -- heading/section label where known
  content text not null,
  embedding extensions.vector(1536),     -- text-embedding-3-small
  search_vec tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now()
);
create index chunks_embedding_idx on chunks
  using hnsw (embedding extensions.vector_cosine_ops);
create index chunks_search_idx on chunks using gin (search_vec);
create index chunks_file_idx on chunks (file_id);

-- ── chat_messages: audit trail for every exchange ───────────
create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  chunk_ids text[],                      -- chunks retrieved for this answer
  model text,                            -- provider/model that answered
  created_at timestamptz not null default now()
);
create index chat_messages_user_idx on chat_messages (user_id, created_at desc);

-- ── RLS: deny-all for client roles ──────────────────────────
alter table synced_files enable row level security;
alter table chunks enable row level security;
alter table chat_messages enable row level security;

revoke all on public.synced_files from anon, authenticated;
revoke all on public.chunks from anon, authenticated;
revoke all on public.chat_messages from anon, authenticated;
