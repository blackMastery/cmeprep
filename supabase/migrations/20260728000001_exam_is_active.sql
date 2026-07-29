-- ── exams.is_active: the sale gate ─────────────────────────────
--
-- Until now an exam was purchasable the instant its row existed, so there was
-- no way to build out a question bank before students could pay for it. This
-- is the exam mirror of plans.is_active.
--
-- Default true so every existing exam keeps selling across the migration.
--
-- Deactivating is NOT a revocation: it removes the exam from checkout and
-- from the practice wizard's upsell, while anyone holding a live subscription
-- to it keeps full access until their period ends. The purchase path checks
-- this flag only when CREATING an order — never when granting a captured
-- payment, or a deactivation mid-checkout would take a buyer's money and
-- refuse them the exam.
alter table exams
  add column is_active boolean not null default true;

comment on column exams.is_active is
  'Offered for purchase at checkout. Inactive exams stay fully usable for anyone who already bought them.';

-- Nothing to do for RLS or grants: exams_select already exposes the row to
-- authenticated readers, and the admin write policy covers this column.
