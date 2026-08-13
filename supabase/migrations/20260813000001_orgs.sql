-- Teams & Enterprises v1 (SPEC.md §2): org accounts.
--
-- Membership grants exam access AT READ TIME (lib/entitlements-core.ts) — no
-- per-user subscriptions rows are ever materialized for members, so churn
-- needs no fan-out and no reconciliation.
--
-- This migration also lands exams.org_id and the taxonomy/options read
-- policies in the same set as the org tables, so there is never a deployed
-- state where private banks can exist but cross-org scoping doesn't.

-- Invite/email binding is strict but case-insensitive (SPEC §4), so the
-- column type does the comparison rather than every call site remembering to.
create extension if not exists citext;

-- ── orgs ────────────────────────────────────────────────────
create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Storage object in the org-branding bucket; shown in the app shell.
  logo_path text,
  -- Risk-flagging inputs (SPEC §8). Org-configurable with platform defaults.
  pass_mark_pct int not null default 60
    check (pass_mark_pct between 1 and 100),
  risk_inactivity_days int not null default 7
    check (risk_inactivity_days between 1 and 90),
  -- Raised from plans.seat_limit at grant time; platform admin may override.
  seat_limit int not null default 90 check (seat_limit > 0),
  -- Platform-admin kill switch: treated exactly like a lapsed subscription,
  -- regardless of actual subscription state (lib/orgs-core.ts).
  suspended_at timestamptz,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- ── org_members ─────────────────────────────────────────────
-- role is text + check, not a pg enum — org roles live on the MEMBERSHIP so
-- profiles.role never becomes a second source of entitlement truth.
create table org_members (
  org_id uuid not null references orgs (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id),
  -- ONE org per user in v1 (SPEC §1). Drop this to enable multi-org later.
  unique (user_id)
);

-- ── org_invites ─────────────────────────────────────────────
create table org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  email citext not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  invited_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz
);

-- One live invite per address per org. "Live" here cannot exclude expiry —
-- an index predicate can't reference now() — so re-inviting an EXPIRED
-- address updates the existing row (fresh expires_at) instead of inserting.
-- Seat math treats expired invites as free seats either way (lib/orgs-core.ts).
create unique index org_invites_pending_key on org_invites (org_id, email)
  where accepted_at is null and revoked_at is null;

create index org_invites_org_idx on org_invites (org_id);

-- ── org_subscriptions ───────────────────────────────────────
-- Mirrors subscriptions, scoped to an org instead of a user. Stale-'active'
-- rows and the 14-day grace are handled in lib/orgs-core.ts, never in SQL —
-- same single-statement-of-the-rule posture as isEffectivelyActive.
create table org_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  -- Soft link to plans; null for bespoke admin grants and deleted plans.
  plan_id uuid references plans (id) on delete set null,
  -- Free-text snapshot, mirrors subscriptions.plan.
  plan text not null,
  status sub_status not null default 'active',
  current_period_end timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index org_subscriptions_org_idx on org_subscriptions (org_id);

-- ── membership helpers ──────────────────────────────────────
-- SECURITY DEFINER like is_admin(): policies on org_members itself (and on
-- the taxonomy below) need these checks without recursing into org_members'
-- own RLS.
create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members
    where org_id = org and user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members
    where org_id = org and user_id = auth.uid() and role = 'admin'
  );
$$;

revoke execute on function public.is_org_member(uuid), public.is_org_admin(uuid)
  from anon;
grant execute on function public.is_org_member(uuid), public.is_org_admin(uuid)
  to authenticated;

-- ── exams.org_id: private banks (SPEC §6) ───────────────────
-- null = public catalog. Specialties/subjects/questions scope through their
-- exam rather than each carrying an org_id that could drift from it.
alter table exams add column org_id uuid references orgs (id);
create index exams_org_idx on exams (org_id) where org_id is not null;

-- Taxonomy visibility, one SECURITY DEFINER function per level so a policy
-- never queries another RLS'd table as the caller (which would re-enter that
-- table's policies row by row).
create or replace function public.exam_is_visible(exam uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.exams e
    where e.id = exam
      and (e.org_id is null or public.is_org_member(e.org_id))
  );
$$;

create or replace function public.specialty_is_visible(specialty uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.specialties sp
    join public.exams e on e.id = sp.exam_id
    where sp.id = specialty
      and (e.org_id is null or public.is_org_member(e.org_id))
  );
$$;

create or replace function public.subject_is_visible(subject uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subjects s
    join public.specialties sp on sp.id = s.specialty_id
    join public.exams e on e.id = sp.exam_id
    where s.id = subject
      and (e.org_id is null or public.is_org_member(e.org_id))
  );
$$;

revoke execute on function
  public.exam_is_visible(uuid),
  public.specialty_is_visible(uuid),
  public.subject_is_visible(uuid)
from anon;
grant execute on function
  public.exam_is_visible(uuid),
  public.specialty_is_visible(uuid),
  public.subject_is_visible(uuid)
to authenticated;

-- Same policy shapes as before, each narrowed by its level's visibility rule.
drop policy exams_select on exams;
create policy exams_select on exams
  for select to authenticated
  using (org_id is null or public.is_org_member(org_id) or public.is_admin());

drop policy specialties_select on specialties;
create policy specialties_select on specialties
  for select to authenticated
  using (public.exam_is_visible(exam_id) or public.is_admin());

drop policy subjects_select on subjects;
create policy subjects_select on subjects
  for select to authenticated
  using (public.subject_is_visible(id) or public.is_admin());

drop policy questions_select on questions;
create policy questions_select on questions
  for select to authenticated
  using (
    public.is_admin()
    or (is_published
        and deleted_at is null
        and public.subject_is_visible(subject_id))
  );

-- question_options_public is SECURITY DEFINER on purpose (20260718000003) —
-- it must bypass the base table's deny-all RLS, so the questions policy above
-- does NOT protect it. The org wall therefore goes into the view's own WHERE
-- clause. Column list unchanged ⇒ create or replace preserves grants.
create or replace view public.question_options_public
  with (security_invoker = false, security_barrier = true) as
  select qo.id, qo.question_id, qo.label, qo.position
  from public.question_options qo
  join public.questions q on q.id = qo.question_id
  join public.subjects s on s.id = q.subject_id
  join public.specialties sp on sp.id = s.specialty_id
  join public.exams e on e.id = sp.exam_id
  where q.is_published
    and q.deleted_at is null
    and qo.deleted_at is null
    and (e.org_id is null or public.is_org_member(e.org_id));

-- ── RLS: org tables ─────────────────────────────────────────
alter table orgs enable row level security;
alter table org_members enable row level security;
alter table org_invites enable row level security;
alter table org_subscriptions enable row level security;

-- Client roles READ only what entitlements and the app shell need. ALL org
-- mutations go through server actions / route handlers on the service-role
-- client after requireOrgAdmin()/requireAdmin() — one write path, like the
-- rest of the schema.
create policy orgs_select on orgs
  for select to authenticated
  using (public.is_org_member(id) or public.is_admin());

create policy org_members_select on org_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_org_admin(org_id)
    or public.is_admin()
  );

-- org_invites: no client policy at all. Invites carry other people's email
-- addresses; the org-admin roster UI and the accept page both read them
-- server-side (service role) after verifying the caller — like
-- contact_messages.
create policy org_subscriptions_select on org_subscriptions
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_admin());

-- ── grants ──────────────────────────────────────────────────
-- Explicit privileges (see 20260718000004): postgres-created tables default
-- to no DML for these roles, service_role included.
grant select, insert, update, delete on
  public.orgs,
  public.org_members,
  public.org_invites,
  public.org_subscriptions
to service_role;

grant select on
  public.orgs,
  public.org_members,
  public.org_subscriptions
to authenticated;
