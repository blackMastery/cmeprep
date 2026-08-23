-- ── Exam names: unique per scope, not globally ─────────────────
-- exams_name_key was a global UNIQUE (name), created before orgs existed.
-- With private org banks that is both wrong and leaky: Org A's "Anatomy"
-- blocked Org B's (and any name the public catalogue uses), and the
-- resulting error told an org admin that a name exists in a tenant they
-- cannot see. Scope it instead:
--   * public catalogue exams (org_id is null) stay unique among themselves;
--   * org exams are unique within their own org only.
-- Partial unique INDEXES rather than constraints — constraints cannot take
-- a WHERE clause. Nothing upserts on exams(name), so no ON CONFLICT target
-- depended on the old constraint.
alter table exams drop constraint exams_name_key;

create unique index exams_public_name_key
  on exams (name)
  where org_id is null;

create unique index exams_org_name_key
  on exams (org_id, name)
  where org_id is not null;
