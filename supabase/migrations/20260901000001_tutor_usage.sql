-- Admin token-usage rollups for the AI tutor (app/admin/tutor).
--
-- chat_messages.prompt_tokens / completion_tokens have been written by the
-- tutor service since 20260825000001_tutor_ui.sql "so a cost cap can be tuned
-- against real numbers rather than guessed" — but nothing read them back in
-- aggregate. PostgREST has no GROUP BY, so the folds live here, following the
-- question_report_attempt_counts precedent (service-role-only RPCs).

-- Both functions filter on created_at alone; the existing
-- (user_id, created_at desc) index cannot serve that.
create index chat_messages_created_at_idx on chat_messages (created_at);

-- One row per (Guyana civil day, model). role='user' rows have no model, so
-- the model-null row carries `questions`; refusals never reach the LLM and so
-- have no model either, which is why that row can also carry `answers`. A
-- partial answer persisted on client disconnect keeps its model but has null
-- tokens: `answers - measured` is "not measured", never 0. `questions -
-- answers` is the count of calls that failed before producing any row.
--
-- Bounds are half-open and nullable so "all time" is a null p_from. Row count
-- is days x (models + 1); PostgREST caps setof results at 1000, so "all time"
-- holds ~500 days at one chat model. Past that, page with .rpc(...).range().
create function tutor_usage_by_day(
  p_from timestamptz default null,
  p_to   timestamptz default null
)
returns table (
  day date,
  model text,
  questions bigint,
  answers bigint,
  measured bigint,
  prompt_tokens bigint,
  completion_tokens bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (m.created_at at time zone 'America/Guyana')::date as day,
    m.model,
    count(*) filter (where m.role = 'user') as questions,
    count(*) filter (where m.role = 'assistant') as answers,
    count(*) filter (
      where m.role = 'assistant' and m.prompt_tokens is not null
    ) as measured,
    -- sum() over an all-null group (the user rows) is null, not 0.
    coalesce(sum(m.prompt_tokens), 0)::bigint as prompt_tokens,
    coalesce(sum(m.completion_tokens), 0)::bigint as completion_tokens
  from chat_messages m
  where (p_from is null or m.created_at >= p_from)
    and (p_to is null or m.created_at < p_to)
  group by 1, 2
  order by 1, 2 nulls first
$$;

-- The same bucket shape keyed by (user, model) for the top p_limit users by
-- total tokens. Per model rather than per user so each row can be priced
-- exactly — rates differ by model, and a student's history can span two.
create function tutor_usage_by_user(
  p_from  timestamptz default null,
  p_to    timestamptz default null,
  p_limit int default 50
)
returns table (
  user_id uuid,
  model text,
  questions bigint,
  answers bigint,
  measured bigint,
  prompt_tokens bigint,
  completion_tokens bigint,
  last_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select m.user_id, m.role, m.model, m.prompt_tokens, m.completion_tokens,
           m.created_at
    from chat_messages m
    where m.user_id is not null
      and (p_from is null or m.created_at >= p_from)
      and (p_to is null or m.created_at < p_to)
  ),
  top_users as (
    select s.user_id
    from scoped s
    group by s.user_id
    order by
      coalesce(sum(s.prompt_tokens), 0) + coalesce(sum(s.completion_tokens), 0)
        desc,
      s.user_id
    limit p_limit
  )
  select
    s.user_id,
    s.model,
    count(*) filter (where s.role = 'user') as questions,
    count(*) filter (where s.role = 'assistant') as answers,
    count(*) filter (
      where s.role = 'assistant' and s.prompt_tokens is not null
    ) as measured,
    coalesce(sum(s.prompt_tokens), 0)::bigint as prompt_tokens,
    coalesce(sum(s.completion_tokens), 0)::bigint as completion_tokens,
    max(s.created_at) as last_at
  from scoped s
  join top_users t on t.user_id = s.user_id
  group by s.user_id, s.model
  order by s.user_id, s.model nulls first
$$;

-- security definer reads every student's chat log; only the service role may
-- call these, and the admin page verifies the caller first (requireAdmin).
revoke all on function tutor_usage_by_day(timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function tutor_usage_by_user(timestamptz, timestamptz, int)
  from public, anon, authenticated;
grant execute on function tutor_usage_by_day(timestamptz, timestamptz)
  to service_role;
grant execute on function tutor_usage_by_user(timestamptz, timestamptz, int)
  to service_role;
