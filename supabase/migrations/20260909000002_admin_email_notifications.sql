-- Platform-admin email notifications (notifications-plan.md, "Platform
-- admins" follow-up): one more optional category on the preferences row.
--
-- admin_operations covers the mail only a platform admin receives — contact
-- messages as they arrive, the daily queue digest (messages, question
-- reports, pending reviews) and the OpenAI failure-threshold alerts. Import
-- completion and admin-role changes are transactional and have no toggle.
-- The column is on every row (a non-admin simply never receives anything in
-- the category) so the preferences shape stays one table with no role join.
alter table notification_preferences
  add column admin_operations boolean not null default true;

comment on column notification_preferences.admin_operations is
  'Platform-admin only: contact messages, the daily ops digest and OpenAI failure alerts. Meaningless on non-admin rows.';

-- ── Indexes for /admin/emails ───────────────────────────────
-- The monitor lists the outbox newest-first, per status or all, and reads
-- the latest email.scan / email.deliver audit row for its heartbeat tiles.
-- email_outbox_queue_idx (partial on status = 'queued', keyed on
-- scheduled_for) serves the worker only; without these the page seq-scans
-- and sorts both tables on every visit, and both grow monotonically.
create index email_outbox_status_created_idx
  on email_outbox (status, created_at desc, id desc);
create index email_outbox_created_idx
  on email_outbox (created_at desc, id desc);
create index audit_logs_action_created_idx
  on audit_logs (action, created_at desc);
