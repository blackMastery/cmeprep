-- Departments (SPEC §1 deferral, now built): org admins group members by
-- department/team for reporting and assignment targeting. One department per
-- member in v1 — a nullable column on the membership row, not a join table.
--
-- Departments are lightweight labels, so deletes are HARD (unlike questions/
-- assignments): FKs SET NULL and the app treats the null as "unassigned" /
-- "department deleted". No history is worth preserving.

-- ── org_departments ─────────────────────────────────────────
create table org_departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- Case-insensitive uniqueness per org: "Cardiology" and "cardiology" are the
-- same department. A casing-only rename still updates in place (lower()
-- unchanged). Count cap (MAX_ORG_DEPARTMENTS) is app-side, like seat limits.
-- The unique index's leading org_id column also serves org-scoped lookups —
-- no separate (org_id) index needed.
create unique index org_departments_name_key on org_departments (org_id, lower(name));

-- ── membership / invite / assignment columns ────────────────
alter table org_members
  add column department_id uuid references org_departments (id) on delete set null,
  -- When the CURRENT department_id was assigned. Drives the completion cohort
  -- rule (countsTowardDeptAssignment, lib/orgs-core.ts): members moved into a
  -- department after an assignment's due date are never counted or marked
  -- late. Meaningful only while department_id is non-null.
  add column department_changed_at timestamptz;

create index org_members_department_idx on org_members (department_id)
  where department_id is not null;

-- Invites optionally pre-assign a department; accept copies it onto the
-- membership. SET NULL means a deleted department simply lands the invitee
-- unassigned — no stale-reference handling anywhere else.
alter table org_invites
  add column department_id uuid references org_departments (id) on delete set null;

-- Same partial-index pattern as org_members above: hard-deleting a
-- department fires SET NULL across three referencing tables, and without
-- these Postgres sequential-scans the whole cross-org table per delete.
create index org_invites_department_idx on org_invites (department_id)
  where department_id is not null;

-- Third audience: dynamic department targeting. No target rows are ever
-- materialized — visibility resolves against the member's CURRENT
-- department_id (RLS below), so joiners inherit and leavers drop out.
alter table org_assignments
  add column department_id uuid references org_departments (id) on delete set null;

create index org_assignments_department_idx on org_assignments (department_id)
  where department_id is not null;

alter table org_assignments drop constraint org_assignments_audience_check;
alter table org_assignments add constraint org_assignments_audience_check
  check (audience in ('all', 'selected', 'department'));

-- One-directional on purpose: audience='department' with department_id null
-- IS the "department deleted" state (SET NULL above), so we cannot require
-- the id — we only forbid it on the other audiences.
alter table org_assignments add constraint org_assignments_department_check
  check (department_id is null or audience = 'department');

-- ── helper + policy rewrite ─────────────────────────────────
-- SECURITY DEFINER like is_org_member(): the org_assignments policy needs the
-- caller's own org_members row without recursing into org_members RLS. The
-- explicit null guard is what makes deleted-department assignments match
-- NOBODY — keep it explicit rather than relying on "= null" never matching.
--
-- Deliberately LOOSER than the app's cohort rule (countsTowardDeptAssignment
-- adds department_changed_at < due_at): encoding the timestamp comparison
-- here would restate that rule in a second language, and the delta only
-- lets a member who joined the department after the deadline read the
-- assignment's metadata within their own org — assignmentsForMember still
-- hides it from every app surface. No org predicate either: department ids
-- are unguessable uuids and v1's unique(user_id) one-org rule makes a
-- cross-org department_id unreachable; revisit both if multi-org lands.
create or replace function public.is_department_member(dept uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select dept is not null and exists (
    select 1 from public.org_members
    where user_id = auth.uid() and department_id = dept
  );
$$;

revoke execute on function public.is_department_member(uuid) from anon;
grant execute on function public.is_department_member(uuid) to authenticated;

-- Same shape as before with the department branch added.
drop policy org_assignments_select on org_assignments;
create policy org_assignments_select on org_assignments
  for select to authenticated
  using (
    public.is_org_admin(org_id)
    or public.is_admin()
    or (
      public.is_org_member(org_id)
      and deleted_at is null
      and (
        audience = 'all'
        or (audience = 'selected' and public.is_assignment_target(id))
        or (audience = 'department' and public.is_department_member(department_id))
      )
    )
  );

-- ── RLS + grants ────────────────────────────────────────────
alter table org_departments enable row level security;

-- Members may read their org's department names (their own label in the
-- shell); all writes are server actions on the service-role client after
-- requireOrgAdmin(), like every other org table.
create policy org_departments_select on org_departments
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_admin());

-- Explicit privileges (see 20260718000004): postgres-created tables default
-- to no DML for these roles, service_role included.
grant select, insert, update, delete on public.org_departments to service_role;
grant select on public.org_departments to authenticated;
