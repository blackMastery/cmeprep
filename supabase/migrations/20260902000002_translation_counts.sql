-- /admin/translations counts in one round trip.
--
-- The languages card needs "cached rows" and "requests" per language. One
-- head-count per registry language was 20 requests per render, and a
-- `select language from language_requests` tally is silently truncated by
-- PostgREST's max_rows (1000) — the same trap open_report_question_count
-- exists to avoid. Aggregate in SQL instead: at most one row per language.
create function translation_language_counts()
returns table (language text, cached bigint, requests bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    language,
    coalesce(c.n, 0)::bigint as cached,
    coalesce(r.n, 0)::bigint as requests
  from (select language, count(*) as n from question_translations group by 1) c
  full join (select language, count(*) as n from language_requests group by 1) r
    using (language)
$$;

-- security definer reads across users; only the service role may call it,
-- and the caller verifies the admin first.
revoke all on function translation_language_counts()
  from public, anon, authenticated;
grant execute on function translation_language_counts() to service_role;

-- translation_events.test_id is `on delete set null`: without an index every
-- hard delete of a tests row (the creation rollback) scans the log.
create index translation_events_test_idx on translation_events (test_id);
