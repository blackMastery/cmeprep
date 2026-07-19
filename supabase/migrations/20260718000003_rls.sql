-- Row Level Security — the security backbone.
-- Rule of thumb: clients (anon/authenticated) can only READ what policies
-- allow; ALL mutations of exam-critical tables happen in Route Handlers
-- using the service-role client, which bypasses RLS.

alter table profiles enable row level security;
alter table subjects enable row level security;
alter table topics enable row level security;
alter table questions enable row level security;
alter table question_options enable row level security;
alter table tests enable row level security;
alter table test_questions enable row level security;
alter table test_answers enable row level security;
alter table attempts enable row level security;
alter table bookmarks enable row level security;
alter table notes enable row level security;
alter table site_content enable row level security;
alter table subscriptions enable row level security;
alter table payment_events enable row level security;
alter table audit_logs enable row level security;

-- ── profiles ────────────────────────────────────────────────
create policy profiles_select on profiles
  for select using (id = auth.uid() or public.is_admin());

-- Users may update ONLY full_name on their own row: the policy limits the
-- row, the column-level grant limits the column. Role/trials/banned changes
-- go through service-role routes.
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;

create policy profiles_update_own on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ── content hierarchy ───────────────────────────────────────
create policy subjects_select on subjects
  for select to authenticated using (true);
create policy subjects_admin_write on subjects
  for all using (public.is_admin()) with check (public.is_admin());

create policy topics_select on topics
  for select to authenticated using (true);
create policy topics_admin_write on topics
  for all using (public.is_admin()) with check (public.is_admin());

-- ── questions ───────────────────────────────────────────────
create policy questions_select on questions
  for select to authenticated
  using ((is_published and deleted_at is null) or public.is_admin());
create policy questions_admin_write on questions
  for all using (public.is_admin()) with check (public.is_admin());

-- ── question_options: is_correct MUST NOT leak ──────────────
-- Hard-revoke direct reads for client roles; students get options through
-- the definer view below, which simply has no is_correct column.
revoke all on public.question_options from anon, authenticated;

create policy question_options_admin on question_options
  for all using (public.is_admin()) with check (public.is_admin());
-- (service_role bypasses RLS; admins currently mutate via service routes,
-- and the revoke above keeps even admin browser sessions away from the
-- base table — deliberate: one read path for clients, zero for secrets.)

-- The ONLY client-visible shape of options. SECURITY DEFINER semantics
-- (security_invoker = false) are INTENTIONAL: the view must bypass the
-- base table's deny-all RLS. The WHERE clause is the guard: options are
-- visible only for published, non-deleted questions.
create view public.question_options_public
  with (security_invoker = false, security_barrier = true) as
  select qo.id, qo.question_id, qo.label, qo.position
  from public.question_options qo
  join public.questions q on q.id = qo.question_id
  where q.is_published and q.deleted_at is null;

revoke all on public.question_options_public from anon, authenticated;
grant select on public.question_options_public to authenticated;

-- ── tests / test_questions / test_answers ───────────────────
create policy tests_select_own on tests
  for select using (user_id = auth.uid() or public.is_admin());
-- inserts/updates: service-role routes only (no client policies)

create policy test_questions_select_own on test_questions
  for select using (
    exists (select 1 from tests t
            where t.id = test_questions.test_id and t.user_id = auth.uid())
  );

create policy test_answers_select_own on test_answers
  for select using (
    exists (select 1 from tests t
            where t.id = test_answers.test_id and t.user_id = auth.uid())
  );
-- writes: service-role autosave route only

-- ── attempts (append-only) ──────────────────────────────────
create policy attempts_select_own on attempts
  for select using (user_id = auth.uid() or public.is_admin());
-- inserts: service-role submit route only; no update/delete for anyone

-- ── bookmarks / notes ───────────────────────────────────────
create policy bookmarks_select_own on bookmarks
  for select using (user_id = auth.uid());
create policy bookmarks_insert_own on bookmarks
  for insert with check (user_id = auth.uid());
create policy bookmarks_delete_own on bookmarks
  for delete using (user_id = auth.uid());

create policy notes_select_own on notes
  for select using (user_id = auth.uid());
create policy notes_insert_own on notes
  for insert with check (user_id = auth.uid());
create policy notes_update_own on notes
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notes_delete_own on notes
  for delete using (user_id = auth.uid());

-- ── site_content ────────────────────────────────────────────
create policy site_content_select on site_content
  for select using (true);
create policy site_content_admin_write on site_content
  for all using (public.is_admin()) with check (public.is_admin());

-- ── payments / audit ────────────────────────────────────────
create policy subscriptions_select_own on subscriptions
  for select using (user_id = auth.uid() or public.is_admin());
-- writes: PayPal webhook route (service role) only

create policy payment_events_admin_select on payment_events
  for select using (public.is_admin());

create policy audit_logs_admin_select on audit_logs
  for select using (public.is_admin());

-- ── dashboard analytics views ───────────────────────────────
-- security_invoker = ON: these views respect the caller's RLS on attempts,
-- so every user computes over their own rows only.

create view public.user_stats
  with (security_invoker = true) as
  select
    a.user_id,
    count(*)::int as attempted,
    (count(*) filter (where a.is_correct))::int as correct,
    round(100.0 * (count(*) filter (where a.is_correct)) / count(*), 1) as accuracy_pct
  from attempts a
  group by a.user_id;

create view public.topic_accuracy
  with (security_invoker = true) as
  select
    a.user_id,
    t.id as topic_id,
    t.name as topic_name,
    s.id as subject_id,
    s.name as subject_name,
    count(*)::int as attempts,
    (count(*) filter (where a.is_correct))::int as correct,
    round(100.0 * (count(*) filter (where a.is_correct)) / count(*), 1) as accuracy_pct
  from attempts a
  join questions q on q.id = a.question_id
  join topics t on t.id = q.topic_id
  join subjects s on s.id = t.subject_id
  group by a.user_id, t.id, t.name, s.id, s.name;

create view public.user_daily_activity
  with (security_invoker = true) as
  select distinct user_id, (answered_at at time zone 'America/Guyana')::date as day
  from attempts;

grant select on public.user_stats, public.topic_accuracy, public.user_daily_activity
  to authenticated;
