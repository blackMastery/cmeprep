-- Payment plans, managed from /admin/plans and displayed on the public
-- pricing section, the trial-limit upsell and the admin subscription form.

create table plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  price_cents int not null check (price_cents >= 0),
  period text not null,            -- e.g. "one month access"
  description text,                -- one-liner; also the trial-card note
  features text[] not null default '{}',
  duration_months int,             -- null = admin picks the end date manually
  featured boolean not null default false,
  is_active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

-- Same everyone-readable pattern as site_content: the pricing section is
-- public marketing content, so anon may read; writes are admin-only and go
-- through the service-role client.
alter table plans enable row level security;
create policy plans_select on plans
  for select using (true);
create policy plans_admin_write on plans
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.plans to service_role;
grant select on public.plans to authenticated;
grant select on public.plans to anon;

-- Backfill the three tiers currently hardcoded in the UI, verbatim.
insert into plans (name, price_cents, period, description, features, duration_months, featured, is_active, position) values
  ('Trial', 0, 'free forever', 'See the question quality before paying anything.',
   array['10 questions from the bank','2 timed practice tests','Full explanations'],
   null, false, true, 0),
  ('1 month', 14400, 'one month access', 'Everything, for the month before your exam.',
   array['Unlimited questions, 7 question banks','1 OSCE station bank','Timed mock exams with instant scoring','Real-time analytics & study plans'],
   1, false, true, 1),
  ('3 months', 21600, 'three months access', 'The full run-up, at half the monthly rate.',
   array['Everything in 1 month','Three full months of access','Adaptive bank that evolves with you','New questions as they''re added'],
   3, true, true, 2);
