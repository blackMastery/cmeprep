-- Admin "Users & subscriptions" support. No table changes.

-- 1) Emails bridge for the admin user list.
-- PostgREST cannot query the auth schema, and auth.admin.listUsers() cannot
-- filter by email — a view is the only shape that supports one-query ilike
-- search and .in(id, ...) joins. SECURITY DEFINER semantics
-- (security_invoker = false) are INTENTIONAL: the view must read auth.users
-- with its owner's (postgres) rights, and Supabase's security advisor will
-- flag it — that is expected. The grants are the guard: client roles get
-- nothing; only the service-role admin client may read it.
create view public.user_emails
  with (security_invoker = false) as
  select id, email
  from auth.users;

revoke all on public.user_emails from anon, authenticated;
grant select on public.user_emails to service_role;

-- 2) Grant fixup: 20260721000001 dropped + recreated topic_accuracy and
-- re-granted only `authenticated`. The DROP discarded service_role's SELECT
-- from 0004's blanket grant, and no default privileges restore it (see the
-- 20260718000004_grants.sql header). Restore parity with user_stats /
-- user_daily_activity so service-role admin reads don't fail.
grant select on public.topic_accuracy to service_role;
