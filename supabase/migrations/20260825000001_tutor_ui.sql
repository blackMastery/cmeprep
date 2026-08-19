-- Tutor Agent — Phase 3: the student chat UI.
--
-- The FastAPI tutor service already owns the retrieval index and writes every
-- exchange to chat_messages over a direct Postgres connection. This migration
-- adds what the *app* needs on top: privileges for the route handlers, spend
-- accounting, a conversation boundary so "New conversation" means something,
-- and a bad-answer report queue.

-- ── service_role privileges the grants migration missed ─────
-- 20260718000004_grants.sql ran `grant ... on all tables in schema public to
-- service_role` BEFORE the tutor tables existed (0718 < 0824), so they inherited
-- the default ACL: no DML for anyone. The tutor service is unaffected (it
-- connects as postgres and bypasses this), but every createAdminClient() read
-- from a route handler would fail with "permission denied for table".
grant select, insert, update, delete on
  public.synced_files,
  public.chunks,
  public.chat_messages,
  public.file_assets,
  public.asset_descriptions
to service_role;

-- ── spend accounting ────────────────────────────────────────
-- Populated by the tutor service from the model's usage metadata. Nothing gates
-- on these yet: the message-count caps are the live limiter, and these exist so
-- a cost cap can be tuned against real numbers rather than guessed.
alter table chat_messages add column prompt_tokens int;
alter table chat_messages add column completion_tokens int;

-- ── conversation boundary ───────────────────────────────────
-- The tutor's memory is a LangGraph checkpointer keyed on user_id, and
-- chat_messages is an append-only audit trail that must never be deleted. So
-- "New conversation" moves this marker forward and clears the checkpointer
-- thread; history renders from the marker onwards. One row per student.
create table tutor_threads (
  user_id uuid primary key references profiles on delete cascade,
  conversation_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table tutor_threads enable row level security;
revoke all on public.tutor_threads from anon, authenticated;
grant select, insert, update, delete on public.tutor_threads to service_role;

-- ── bad-answer reports ──────────────────────────────────────
-- "Report this answer": the quality signal for a strict-RAG tutor, and the
-- paper trail for a medical-adjacent product. Follows osce_grade_reports —
-- no regeneration mechanics, the answer stands. FK to the assistant message
-- carries the question, retrieved chunk_ids, model and tokens with it.
create table tutor_answer_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles,
  message_id uuid not null references chat_messages on delete cascade,
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references profiles on delete set null,
  unique (user_id, message_id)
);
-- The admin queue reads `handled_at nulls first, created_at desc` — the index
-- has to declare the same null ordering or it can't serve the sort.
create index tutor_answer_reports_open_idx
  on tutor_answer_reports (handled_at nulls first, created_at desc);
-- message_id is an `on delete cascade` referencing column: without an index,
-- deleting a chat_messages row seq-scans this table.
create index tutor_answer_reports_message_idx on tutor_answer_reports (message_id);
alter table tutor_answer_reports enable row level security;
revoke all on public.tutor_answer_reports from anon, authenticated;
grant select, insert, update, delete on public.tutor_answer_reports to service_role;

-- ── conversation reset ──────────────────────────────────────
-- The boundary must be stamped by the DATABASE clock. chat_messages.created_at
-- is `default now()`, so a marker stamped on the Next.js server is compared
-- against Postgres timestamps across two machines: a server clock running fast
-- hides the first exchange after a reset, and one running slow resurrects the
-- tail of the conversation the checkpointer has already forgotten — the exact
-- two-store disagreement the reset exists to prevent.
create function public.tutor_reset_thread(p_user uuid)
  returns timestamptz
  language sql
  security definer
  set search_path = public
as $$
  insert into tutor_threads (user_id, conversation_started_at, updated_at)
  values (p_user, now(), now())
  on conflict (user_id) do update
    set conversation_started_at = now(), updated_at = now()
  returning conversation_started_at;
$$;

revoke all on function public.tutor_reset_thread(uuid) from public, anon, authenticated;
grant execute on function public.tutor_reset_thread(uuid) to service_role;
