-- Admin business dashboard: daily rollup tables + the nightly job's SQL side.
--
-- Read by app/admin (the business dashboard) through lib/analytics.ts; written
-- by /api/cron/rollup via runNightlyRollup()/runAnalyticsBackfill() in
-- lib/analytics.ts, with every derivation rule (bucketing, refund deltas,
-- thresholds) in lib/analytics-core.ts. The readiness views (20260817000001)
-- are deliberately NOT reused here: they are per-user by contract and an
-- unfiltered select aggregates the whole attempts table — platform-wide trends
-- need precomputed rows, which is what this migration adds.
--
-- Everything here is DERIVED data, recomputable from payments/attempts/tests:
-- RLS is enabled with no policies and nothing is granted to authenticated —
-- every read goes through the service-role client after requireAdmin(). Losing
-- a rollup row costs a backfill re-run, never money or history.
--
-- Days bucket in America/Guyana (fixed UTC-4, no DST), matching
-- user_daily_activity and the readiness views. All bucketing happens in
-- lib/analytics-core.ts (guyanaDayBounds); these tables just store dates.
--
-- ── ONE-TIME SETUP ON A HOSTED PROJECT ─────────────────────
-- Like the reconcile sweep, the schedule reads its target from Vault. Run once
-- per environment, in the SQL editor:
--
--   select vault.create_secret(
--     'https://www.cmeprep.me/api/cron/rollup', 'analytics_rollup_url');
--
-- The bearer reuses the existing 'reconcile_cron_secret' — both routes check
-- the same CRON_SECRET env var, and a second copy of one value is a drift trap.
-- After deploying, run the backfill (POST /api/admin/analytics/rollup with
-- {"mode":"backfill"}, repeatedly until done:true) to load history.

-- ── revenue: gross ──────────────────────────────────────────
-- One row per (day × full breakdown key). Gross is a DETERMINISTIC function of
-- raw payments by capture day, so the rollup job recomputes whole days
-- (delete + insert) and re-running is always safe.
--
-- Kept SEPARATE from refunds on purpose: refunds are watermarked increments
-- (below) that must never be recomputed, and one table holding both would let
-- "recompute gross for day X" clobber refund bookings.
--
-- Key columns are text with sentinels ('none' for a null exam, 'unknown' for a
-- missing plan_name/currency) rather than nullable uuids: Postgres PKs cannot
-- contain NULLs, and the PK is what makes the upsert/delete-by-day idempotent.
-- currency is part of the key so two currencies can NEVER sum into one figure —
-- the app sells USD only, but payments records what PayPal actually reported.
create table analytics_daily_revenue (
  day date not null,
  exam_key text not null,
  plan_key text not null,
  channel text not null check (channel in ('personal', 'org')),
  source text not null,
  currency text not null,
  payments_count int not null default 0,
  gross_cents bigint not null default 0,
  -- Data-quality alarm surfaced on the dashboard: captures that arrived with
  -- no amount at all (payments.amount_cents null). They count here and add 0.
  null_amounts int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, exam_key, plan_key, channel, source, currency)
);

-- ── revenue: refunds ────────────────────────────────────────
-- Net-on-refund-date accounting. payments.refunded_cents is a running total,
-- not a dated log, so each nightly run books the DELTA it observes onto the
-- day it observed it — past days never change, matching cash flow. The
-- backfill instead books pre-launch refunds onto the capture day (accepted
-- one-time distortion; the true dates only exist inside webhook payloads).
create table analytics_daily_refunds (
  day date not null,
  exam_key text not null,
  plan_key text not null,
  channel text not null check (channel in ('personal', 'org')),
  source text not null,
  currency text not null,
  refunds_count int not null default 0,
  refund_cents bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, exam_key, plan_key, channel, source, currency)
);

-- Per-payment watermark: how much of refunded_cents has already been booked
-- into analytics_daily_refunds. delta = refunded_cents - booked_refunded_cents.
-- Cascade is correct: deleting a payment deletes its watermark, and already-
-- booked refund rows deliberately survive (they describe money that moved).
create table analytics_refund_marks (
  payment_id uuid primary key references payments (id) on delete cascade,
  booked_refunded_cents int not null default 0 check (booked_refunded_cents >= 0),
  updated_at timestamptz not null default now()
);

-- ── engagement ──────────────────────────────────────────────
-- One row per user per active Guyana day (>=1 attempts row). This is what
-- makes WAU/MAU computable from rollups (trailing distinct-user windows) and
-- makes re-rolling a day idempotent. Cascade on user delete is fine — the
-- STORED wau/mau below keep the as-observed history.
create table analytics_active_user_days (
  day date not null,
  user_id uuid not null references profiles (id) on delete cascade,
  primary key (day, user_id)
);

create table analytics_daily_engagement (
  day date primary key,
  dau int not null default 0,
  -- Distinct users over the trailing 7/30 days ENDING this day, computed from
  -- analytics_active_user_days at rollup time. Stored, not derived at read
  -- time: they are "as observed" and survive user deletions.
  wau int not null default 0,
  mau int not null default 0,
  tests_started_exam int not null default 0,
  tests_started_tutor int not null default 0,
  tests_submitted_exam int not null default 0,
  tests_submitted_tutor int not null default 0,
  -- Abandoned that day, plus (exam mode only) in_progress tests whose
  -- expires_at fell inside the day and has passed — tutor sessions are untimed
  -- and never expire.
  tests_ended_exam int not null default 0,
  tests_ended_tutor int not null default 0,
  attempts_count int not null default 0,
  correct_count int not null default 0,
  updated_at timestamptz not null default now()
);

-- Platform accuracy trend per exam. Exam resolves through the question
-- taxonomy (questions → subjects → specialties.exam_id), matching the
-- readiness views — NOT tests.config, which is absent on legacy rows.
create table analytics_daily_exam_activity (
  day date not null,
  exam_key text not null,
  attempts int not null default 0,
  correct int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, exam_key)
);

-- ── question stats ──────────────────────────────────────────
-- Per published question, fully recomputed nightly by the function below.
-- Counts only — every threshold (min attempts, "suspiciously easy" cutoff)
-- lives in lib/analytics-core.ts so tuning is a TS change, not a migration.
-- Zero-attempt questions get a row so "cold" is a cheap filter at read time.
create table analytics_question_stats (
  question_id uuid primary key references questions (id) on delete cascade,
  -- Denormalized for the dashboard's exam filter.
  exam_id uuid,
  subject_id uuid not null,
  attempts_count int not null default 0,
  correct_count int not null default 0,
  last_attempted_at timestamptz,
  computed_at timestamptz not null default now()
);

create index analytics_question_stats_exam_idx
  on analytics_question_stats (exam_id);

-- The one aggregation done in SQL rather than analytics-core: it folds the
-- FULL attempts history, which is unbounded and has no business being paged
-- through JS every night. truncate + insert, so a question's deletion or
-- unpublish self-heals on the next run.
create function analytics_recompute_question_stats() returns void
language plpgsql
set search_path = public
as $$
begin
  truncate analytics_question_stats;
  insert into analytics_question_stats
    (question_id, exam_id, subject_id, attempts_count, correct_count,
     last_attempted_at, computed_at)
  select
    q.id,
    sp.exam_id,
    q.subject_id,
    count(a.id)::int,
    (count(a.id) filter (where a.is_correct))::int,
    max(a.answered_at),
    now()
  from questions q
  join subjects s on s.id = q.subject_id
  join specialties sp on sp.id = s.specialty_id
  left join attempts a on a.question_id = q.id
  where q.is_published and q.deleted_at is null
  group by q.id, sp.exam_id, q.subject_id;
end $$;

-- ── exactly-once refund booking ─────────────────────────────
-- PostgREST cannot express an atomic `set x = x + d`, and "book the delta +
-- advance the watermark" must be ONE transaction: a crash between the two
-- writes would double-book (marks written last) or permanently under-book
-- (marks written first). The conditional DO UPDATE ... WHERE makes the call
-- idempotent: it only advances when the stored watermark still equals what the
-- caller computed the delta from, so a concurrent or replayed call books
-- nothing.
create function analytics_book_refund(
  p_payment_id uuid,
  p_day date,
  p_exam_key text,
  p_plan_key text,
  p_channel text,
  p_source text,
  p_currency text,
  p_delta_cents int,
  p_new_booked_cents int
) returns void
language plpgsql
set search_path = public
as $$
begin
  if p_delta_cents <= 0 then
    return;
  end if;

  insert into analytics_refund_marks as m (payment_id, booked_refunded_cents)
    values (p_payment_id, p_new_booked_cents)
    on conflict (payment_id) do update
      set booked_refunded_cents = excluded.booked_refunded_cents,
          updated_at = now()
      where m.booked_refunded_cents = p_new_booked_cents - p_delta_cents;

  -- FOUND is false exactly when the conflict row failed the WHERE guard —
  -- someone already booked past this watermark.
  if not found then
    return;
  end if;

  insert into analytics_daily_refunds as r
    (day, exam_key, plan_key, channel, source, currency,
     refunds_count, refund_cents)
    values (p_day, p_exam_key, p_plan_key, p_channel, p_source, p_currency,
            1, p_delta_cents)
    on conflict (day, exam_key, plan_key, channel, source, currency) do update
      set refunds_count = r.refunds_count + 1,
          refund_cents = r.refund_cents + excluded.refund_cents,
          updated_at = now();
end $$;

-- ── reconcile run summaries ─────────────────────────────────
-- The sweep's heartbeat has only ever lived in audit_logs.meta, which is
-- untyped jsonb in a table that grows with every admin click. The dashboard's
-- ops section wants "latest run + is it stale" as an indexed query, so
-- lib/reconcile.ts now also flattens each SweepSummary into a row here
-- (best-effort — a failed insert must never fail the sweep).
create table reconcile_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  duration_ms int not null,
  truncated boolean not null,
  clean boolean not null,
  events_scanned int not null,
  events_repaired int not null,
  events_failed int not null,
  events_quarantined int not null,
  payments_scanned int not null,
  payments_repaired int not null,
  payments_failed int not null
);

create index reconcile_runs_ran_at_idx on reconcile_runs (ran_at desc);

-- ── rollup job state ────────────────────────────────────────
-- Tiny key/value store: the backfill cursor ('backfill') and the last nightly
-- summary ('last_nightly'). A dedicated table beats overloading audit_logs
-- because the job READS these back.
create table analytics_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ── raw-table indexes the rollup needs ──────────────────────
-- 20260810000001 deliberately skipped a captured_at index "until a report is
-- actually slow" — the report has now arrived: the rollup job, the live
-- "today" cards and the /admin/payments day filter all scan by capture day.
create index payments_captured_at_idx on payments (captured_at);
-- Day-bounded fetches by the rollup + live DAU/attempt counts.
create index attempts_answered_at_idx on attempts (answered_at);
-- Day-window test fetches by the rollup + live "tests today" card.
create index tests_started_at_idx on tests (started_at);

-- ── RLS / grants ────────────────────────────────────────────
-- Derived data, admin-only surface: RLS on with NO policies, nothing granted
-- to authenticated, explicit service_role grants (the 20260718000004 blanket
-- grant only covered tables existing then — without these even admin-client
-- queries fail with "permission denied").
alter table analytics_daily_revenue enable row level security;
alter table analytics_daily_refunds enable row level security;
alter table analytics_refund_marks enable row level security;
alter table analytics_active_user_days enable row level security;
alter table analytics_daily_engagement enable row level security;
alter table analytics_daily_exam_activity enable row level security;
alter table analytics_question_stats enable row level security;
alter table reconcile_runs enable row level security;
alter table analytics_state enable row level security;

grant select, insert, update, delete on
  analytics_daily_revenue,
  analytics_daily_refunds,
  analytics_refund_marks,
  analytics_active_user_days,
  analytics_daily_engagement,
  analytics_daily_exam_activity,
  analytics_question_stats,
  reconcile_runs,
  analytics_state
to service_role;

revoke all on
  analytics_daily_revenue,
  analytics_daily_refunds,
  analytics_refund_marks,
  analytics_active_user_days,
  analytics_daily_engagement,
  analytics_daily_exam_activity,
  analytics_question_stats,
  reconcile_runs,
  analytics_state
from anon, authenticated;

revoke all on function analytics_recompute_question_stats() from public, anon, authenticated;
grant execute on function analytics_recompute_question_stats() to service_role;
revoke all on function
  analytics_book_refund(uuid, date, text, text, text, text, text, int, int)
from public, anon, authenticated;
grant execute on function
  analytics_book_refund(uuid, date, text, text, text, text, text, int, int)
to service_role;

-- ── Schedule ────────────────────────────────────────────────
-- Same guarded shape as reconcile-payments (20260810000002): safe where
-- pg_cron is unavailable, a no-op until the Vault secrets exist, idempotent
-- across `supabase db reset`.
--
-- 04:30 UTC = 00:30 America/Guyana — half an hour after the analytics day
-- closes, so the just-finished day rolls up in one pass. The job also re-rolls
-- the two prior days (REROLL_DAYS in lib/analytics-core.ts) to absorb
-- late-arriving webhook captures and post-day test expiries.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net with schema extensions;

    perform cron.schedule(
      'analytics-rollup',
      '30 4 * * *',
      $job$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets
                  where name = 'analytics_rollup_url'),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' ||
              (select decrypted_secret from vault.decrypted_secrets
               where name = 'reconcile_cron_secret'))
        )
        where exists (select 1 from vault.decrypted_secrets
                      where name = 'analytics_rollup_url')
          and exists (select 1 from vault.decrypted_secrets
                      where name = 'reconcile_cron_secret');
      $job$
    );
  else
    raise notice
      'pg_cron unavailable — schedule /api/cron/rollup by hand in this environment';
  end if;
end $$;
