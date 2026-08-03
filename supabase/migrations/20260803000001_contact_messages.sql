-- Contact form submissions from the public About page, read at /admin/messages.
--
-- No email is sent anywhere: the project has no mail provider beyond Supabase
-- auth, so the admin inbox IS the delivery mechanism. If a provider is added
-- later, notify off this table rather than moving the write.

create table contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  subject text not null,
  body text not null,
  -- Set when a signed-in visitor submits. Nullable and ON DELETE SET NULL:
  -- deleting an account must not erase the correspondence it started.
  user_id uuid references profiles on delete set null,
  -- Coarse triage only. Read/unread would need a per-admin flag; one shared
  -- "someone has dealt with this" is what a single-inbox team actually uses.
  handled_at timestamptz,
  handled_by uuid references profiles on delete set null,
  created_at timestamptz not null default now()
);

-- The inbox is always read newest-first, unhandled first.
create index contact_messages_triage_idx
  on contact_messages (handled_at nulls first, created_at desc);

-- Unlike plans/site_content, this is NOT public-readable: it holds other
-- people's names, addresses and messages. Admins only, and the insert comes
-- from the service-role client in the Server Action rather than from the
-- browser — so anon and authenticated get no grants at all here. That keeps
-- the honeypot and validation in the action from being trivially bypassed by
-- posting straight at PostgREST.
alter table contact_messages enable row level security;

create policy contact_messages_admin_read on contact_messages
  for select using (public.is_admin());
create policy contact_messages_admin_write on contact_messages
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.contact_messages to service_role;
revoke all on public.contact_messages from anon, authenticated;
