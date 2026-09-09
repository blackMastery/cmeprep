-- Email notifications (notifications-plan.md): the outbox, per-user
-- preferences, a confirmed flag on the emails bridge, and the two cron jobs.
--
-- Nothing here sends mail. Every email is a ROW in email_outbox written by the
-- code path that produced the event (a grant, a refund, an invite, a daily
-- scan), and lib/email.ts delivers rows from /api/cron/email. The unique
-- dedupe_key is what makes the whole thing idempotent: the capture route, the
-- webhook and the reconcile sweep can all try to queue the same receipt and
-- exactly one row exists.
--
-- ── ONE-TIME SETUP ON A HOSTED PROJECT ─────────────────────
-- Same Vault pattern as reconcile-payments (20260810000002). The bearer
-- secret is SHARED with the other cron routes (reconcile_cron_secret = the
-- CRON_SECRET env var); only the url is new:
--
--   select vault.create_secret(
--     'https://www.cmeqbank.com/api/cron/email', 'email_url');
--
-- Missing secrets make the jobs no-ops, never unauthenticated calls.

-- ── Outbox ──────────────────────────────────────────────────
create table email_outbox (
  id uuid primary key default gen_random_uuid(),
  -- Recipient. Org-admin mail still targets one profile per row: "every
  -- admin" is N rows with N dedupe keys, so a new admin can be added to a
  -- half-sent batch without re-sending the rest.
  user_id uuid not null references profiles (id) on delete cascade,
  -- Registry lives in lib/email-core.ts (EMAIL_TEMPLATES), not a CHECK: only
  -- the service role writes here, and a CHECK would cost a migration per new
  -- template while guarding against nothing a code review doesn't. The
  -- worker skips rows whose template it does not know.
  template text not null,
  -- Everything the template needs, already resolved (names, labels, paths).
  -- Rendering never touches the DB, so a deleted plan or exam cannot blank
  -- a receipt that was queued while it existed.
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  last_error text,
  -- Why a row was skipped rather than sent: no confirmed address, the
  -- recipient's preference, the log transport in local dev.
  skip_reason text,
  -- The provider's message id, for support to chase a bounce.
  provider_id text,
  -- Lets a scan queue tomorrow's reminder today; the worker only picks rows
  -- whose time has come.
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- The worker's only query. Partial: sent rows are the bulk and never read.
create index email_outbox_queue_idx
  on email_outbox (scheduled_for)
  where status = 'queued';

-- Per-user history (a future "emails we sent you" panel; support lookups).
create index email_outbox_user_idx
  on email_outbox (user_id, created_at desc);

comment on table email_outbox is
  'Outbound email queue (notifications-plan.md). Written by app code, delivered by /api/cron/email. dedupe_key is the idempotency key.';

alter table email_outbox enable row level security;
-- Service-role only: the payload carries names, amounts and org membership,
-- none of which a client role has a reason to read in bulk.
revoke all on email_outbox from anon, authenticated;
grant all on email_outbox to service_role;

-- ── Preferences ─────────────────────────────────────────────
-- One row per profile, created lazily by lib/email.ts the first time a
-- preference is read or written. Absent row = every default below.
--
-- Only OPTIONAL categories are here. Receipts, refunds, invites, removals,
-- role changes and certificates are transactional and have no toggle — the
-- template → category map in lib/email-core.ts says which is which.
create table notification_preferences (
  user_id uuid primary key references profiles (id) on delete cascade,
  expiry_reminders boolean not null default true,
  assignment_reminders boolean not null default true,
  report_updates boolean not null default true,
  -- Opt-IN: a Monday summary nobody asked for is the mail people mark spam.
  weekly_digest boolean not null default false,
  org_admin_events boolean not null default true,
  org_assignment_summary boolean not null default true,
  -- The one-click unsubscribe credential. Unguessable, and its only power
  -- is to turn a category OFF, so a leaked link costs nothing.
  unsubscribe_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

comment on table notification_preferences is
  'Per-user opt-outs for optional email categories (notifications-plan.md). Transactional mail has no toggle.';

alter table notification_preferences enable row level security;

-- Reads of one's own row for the profile card; writes go through the server
-- action on the service role after requireUser(), and the unsubscribe page
-- writes by token with no session at all.
create policy notification_preferences_select_own
  on notification_preferences for select
  to authenticated
  using (user_id = auth.uid());

revoke all on notification_preferences from anon, authenticated;
grant select on notification_preferences to authenticated;
grant all on notification_preferences to service_role;

-- ── Confirmed flag on the emails bridge ─────────────────────
-- The worker must never mail an unverified address: a typo at signup would
-- otherwise receive someone else's receipts. CREATE OR REPLACE appends the
-- column; grants on the view are unchanged but restated so the intent
-- survives a reader who only sees this file.
create or replace view public.user_emails
  with (security_invoker = false) as
  select id, email, (email_confirmed_at is not null) as confirmed
  from auth.users;

revoke all on public.user_emails from anon, authenticated;
grant select on public.user_emails to service_role;

-- ── Schedule ────────────────────────────────────────────────
-- Guarded exactly like reconcile-payments (20260810000002): safe where
-- pg_cron is unavailable, a no-op until the Vault secrets exist, idempotent
-- across `supabase db reset`.
--
-- deliver: every 5 minutes, as the SAFETY NET. Rows are sent the moment they
-- are queued (lib/email.ts, after the response); this job picks up the ones
-- whose immediate send failed and are backing off, the daily scan's bulk
-- rows, and anything a crashed process left claimed. The route's 45s budget
-- (EMAIL_BUDGET_MS) cannot overlap the next tick.
--
-- scan: 12:00 UTC = 08:00 America/Guyana, the timezone user_daily_activity
-- already buckets by, so "7 days left" and "due tomorrow" line up with the
-- student's morning rather than the small hours.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net with schema extensions;

    perform cron.schedule(
      'email-deliver',
      '*/5 * * * *',
      $job$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets
                  where name = 'email_url'),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' ||
              (select decrypted_secret from vault.decrypted_secrets
               where name = 'reconcile_cron_secret')),
          body := '{"job":"deliver"}'::jsonb
        )
        where exists (select 1 from vault.decrypted_secrets
                      where name = 'email_url')
          and exists (select 1 from vault.decrypted_secrets
                      where name = 'reconcile_cron_secret');
      $job$
    );

    perform cron.schedule(
      'email-scan',
      '0 12 * * *',
      $job$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets
                  where name = 'email_url'),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' ||
              (select decrypted_secret from vault.decrypted_secrets
               where name = 'reconcile_cron_secret')),
          body := '{"job":"scan"}'::jsonb
        )
        where exists (select 1 from vault.decrypted_secrets
                      where name = 'email_url')
          and exists (select 1 from vault.decrypted_secrets
                      where name = 'reconcile_cron_secret');
      $job$
    );
  else
    raise notice
      'pg_cron unavailable — schedule /api/cron/email by hand in this environment';
  end if;
end $$;
