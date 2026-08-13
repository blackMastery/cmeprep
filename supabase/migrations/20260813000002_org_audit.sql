-- Org-scoped audit (SPEC.md §10): org-admin actions carry org_id so the
-- org-facing audit page can filter without parsing meta. Platform-admin
-- actions keep org_id null; audit_logs stays service-role only — the org
-- audit page reads through a guarded server layer, not client RLS.
alter table audit_logs add column org_id uuid references orgs (id);

create index audit_logs_org_idx on audit_logs (org_id, id desc)
  where org_id is not null;
