-- Explicit table privileges.
--
-- Why this migration exists: tables created by the `postgres` role (which is
-- what runs these migrations) inherit a default ACL granting anon/
-- authenticated/service_role only Dxtm (TRUNCATE, REFERENCES, TRIGGER,
-- MAINTAIN) — no SELECT/INSERT/UPDATE/DELETE. Only tables created by
-- `supabase_admin` get full DML by default. Without the grants below,
-- every client query fails with "permission denied", including the
-- service-role client used by our route handlers.
--
-- Granting explicitly is also the safer posture: privileges are least-
-- privilege by table, and RLS policies (migration 0003) filter the rows.

-- ── service_role: full DML. Bypasses RLS, but still needs privileges.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ── authenticated: read what RLS allows, write only user-owned tools.
grant select on
  public.profiles,
  public.subjects,
  public.topics,
  public.questions,
  public.tests,
  public.test_questions,
  public.test_answers,
  public.attempts,
  public.bookmarks,
  public.notes,
  public.site_content,
  public.subscriptions
to authenticated;

-- Users manage their own bookmarks and notes directly (RLS scopes to owner).
grant insert, delete on public.bookmarks to authenticated;
grant insert, update, delete on public.notes to authenticated;

-- Profile self-service is limited to full_name at the column level; the
-- profiles_update_own policy limits it to their own row.
grant update (full_name) on public.profiles to authenticated;

-- ── anon: public marketing copy only.
grant select on public.site_content to anon;

-- ── Re-assert the answer-leak control.
-- `grant ... on all tables` above deliberately excludes client roles, but be
-- explicit: correctness must never be readable by a browser session.
revoke all on public.question_options from anon, authenticated;
grant select, insert, update, delete on public.question_options to service_role;
