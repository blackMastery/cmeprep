-- Per-exam org purchases (SPEC.md change): an org subscription now entitles
-- ONE public exam, exactly like a personal subscription — chosen at checkout,
-- stacking per exam, a different exam is a separate purchase. exam_id null
-- keeps the personal-model meaning: an all-access grant, mintable only by
-- platform admins (comp/bespoke deals) — self-serve checkout always names an
-- exam.
--
-- The Teams feature is UNLAUNCHED, so any existing rows here are local/sandbox
-- artifacts; leaving their exam_id null (= comp all-access) is deliberate and
-- harmless.

-- No ON DELETE action (RESTRICT-equivalent), mirroring subscriptions.exam_id:
-- a sold exam must not be hard-deletable out from under paid access.
alter table org_subscriptions add column exam_id uuid references exams (id);

comment on column org_subscriptions.exam_id is
  'Public exam this period buys; null = all-access comp grant (admin/manual only), mirroring subscriptions.exam_id.';

-- No new index: an org holds a handful of subscription rows and every read
-- path filters through org_subscriptions_org_idx first.

-- The seeded Team plan's copy said "every question bank"; it now sells one
-- exam per purchase. Safe to rewrite in place — the plan has never been sold.
update plans
set
  period = 'per exam, per year',
  description = 'One flat price per examination for schools and companies getting a cohort exam-ready together.',
  features = array[
    'Up to 90 users',
    'Full access to one examination''s question bank and mock exams',
    'Add more examinations any time — each is its own purchase',
    'Shared analytics for program directors',
    'Private question banks',
    'Audit logs'
  ],
  updated_at = now()
where id = '00000000-0000-0000-0000-00000000900f';
