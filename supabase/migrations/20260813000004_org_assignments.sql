-- Assignments (SPEC.md §7): an org-admin prescribes a test config + due
-- date; members launch it verbatim and completion is tracked exactly via
-- tests.assignment_id — never inferred from overlapping practice.

create table org_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  title text not null,
  description text,
  -- TestConfig shape: subject_ids, difficulty, num_questions, duration_sec,
  -- exam_id. Stored verbatim so the launched test IS the prescription.
  config jsonb not null,
  due_at timestamptz not null,
  audience text not null default 'all' check (audience in ('all', 'selected')),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Soft delete, matching questions: past tests keep their FK.
  deleted_at timestamptz
);

create index org_assignments_org_idx on org_assignments (org_id)
  where deleted_at is null;

-- Rows only when audience = 'selected'.
create table org_assignment_targets (
  assignment_id uuid not null references org_assignments (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  primary key (assignment_id, user_id)
);

alter table tests add column assignment_id uuid references org_assignments (id);
create index tests_assignment_idx on tests (assignment_id)
  where assignment_id is not null;

-- ── helpers ─────────────────────────────────────────────────
-- SECURITY DEFINER so the two assignment policies can reference each
-- other's tables without recursing into each other's RLS.
create or replace function public.is_assignment_target(assignment uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_assignment_targets
    where assignment_id = assignment and user_id = auth.uid()
  );
$$;

create or replace function public.assignment_org(assignment uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from public.org_assignments where id = assignment;
$$;

revoke execute on function
  public.is_assignment_target(uuid), public.assignment_org(uuid)
from anon;
grant execute on function
  public.is_assignment_target(uuid), public.assignment_org(uuid)
to authenticated;

-- ── RLS ─────────────────────────────────────────────────────
alter table org_assignments enable row level security;
alter table org_assignment_targets enable row level security;

-- Members read what is addressed to them; org-admins read everything in
-- their org (deleted included — their own trash). Writes are server actions
-- on the service-role client only.
create policy org_assignments_select on org_assignments
  for select to authenticated
  using (
    public.is_org_admin(org_id)
    or public.is_admin()
    or (
      public.is_org_member(org_id)
      and deleted_at is null
      and (audience = 'all' or public.is_assignment_target(id))
    )
  );

create policy org_assignment_targets_select on org_assignment_targets
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_org_admin(public.assignment_org(assignment_id))
    or public.is_admin()
  );

-- ── grants ──────────────────────────────────────────────────
grant select, insert, update, delete on
  public.org_assignments, public.org_assignment_targets
to service_role;

grant select on
  public.org_assignments, public.org_assignment_targets
to authenticated;
