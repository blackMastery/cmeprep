-- Reconciliation sweep support, for lib/reconcile.ts behind
-- app/api/cron/reconcile/route.ts.
--
-- payment_events rows deliberately keep processed_at = null when a handler
-- throws (see app/api/paypal/webhook/route.ts) so they stay findable. Until now
-- nothing looked for them, which is the gap the risk register in
-- exam-app-development-plan.md called out and never closed.
--
-- ── ONE-TIME SETUP ON A HOSTED PROJECT ─────────────────────
-- The schedule below reads its target and its bearer token from Supabase Vault.
-- The secrets are NOT created here: a migration is committed to git, and a
-- shared secret in git is not a secret. Run these once per environment, in the
-- SQL editor:
--
--   select vault.create_secret(
--     'https://www.cmeqbank.com/api/cron/reconcile', 'reconcile_url');
--   select vault.create_secret('<same value as CRON_SECRET>',
--     'reconcile_cron_secret');
--
-- If either is missing the header comes out null and the route answers 401, so
-- an unconfigured environment fails closed rather than sweeping unauthenticated.

alter table payment_events
  -- Without an attempt counter a permanently-failing event (deleted plan,
  -- deleted exam) sits at the head of an `order by created_at` queue forever
  -- and starves every newer event behind it. At the cap the row is quarantined
  -- and reported in the sweep summary instead of retried.
  add column replay_attempts int not null default 0,
  add column last_attempt_at timestamptz,
  add column last_error text;

-- The sweep's only query. Partial, because the overwhelming majority of rows
-- are processed and must not bloat the index.
create index payment_events_unprocessed_idx
  on payment_events (created_at)
  where processed_at is null;

comment on column payment_events.replay_attempts is
  'Reconciliation replay count. At MAX_REPLAY_ATTEMPTS (lib/reconcile-core.ts) the row is quarantined and reported in the sweep summary for manual handling.';

-- ── Schedule ────────────────────────────────────────────────
-- Guarded so `supabase db reset` still works wherever pg_cron is unavailable:
-- a missing scheduler must not wedge local development. cron.schedule replaces
-- a job of the same name, so this is idempotent across resets.
--
-- Every 15 minutes, not daily: the worst case this exists to catch is a buyer
-- who paid and has no access, and a day of that is a support ticket rather than
-- a recovery. Retuning means changing this expression and the constants in
-- lib/reconcile-core.ts together.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net with schema extensions;

    -- The `where exists` makes the job a NO-OP until both secrets are present,
    -- rather than firing net.http_post at a null url every 15 minutes. That is
    -- what keeps local dev quiet, and it means the secrets can be created
    -- before or after this migration runs — no deploy-ordering trap.
    perform cron.schedule(
      'reconcile-payments',
      '*/15 * * * *',
      $job$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets
                  where name = 'reconcile_url'),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' ||
              (select decrypted_secret from vault.decrypted_secrets
               where name = 'reconcile_cron_secret'))
        )
        where exists (select 1 from vault.decrypted_secrets
                      where name = 'reconcile_url')
          and exists (select 1 from vault.decrypted_secrets
                      where name = 'reconcile_cron_secret');
      $job$
    );
  else
    raise notice
      'pg_cron unavailable — schedule /api/cron/reconcile by hand in this environment';
  end if;
end $$;
