# Exam Prep Platform — Production Development Plan
**Stack:** Next.js (App Router) + Supabase • **Target:** Production-ready MVQ (Minimum Viable Question-bank) in 8 phases

---

## 1. Goals & Scope

Build a question-bank and mock-exam platform with three account types (Trial, Student, Admin), a timed test engine, per-question analytics, an admin content pipeline (including bulk upload), and PayPal subscriptions added post-launch.

**Out of scope for v1:** mobile apps, proctoring/anti-cheat, leaderboards, multi-language.

---

## 2. Tech Stack & Key Decisions

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15+ (App Router, TypeScript) | Server Components for data-heavy pages, Route Handlers for APIs, Vercel deploy |
| UI | Tailwind CSS + shadcn/ui | Fast, accessible, responsive by default |
| Database | Supabase Postgres | Relational fits questions/tests/attempts perfectly |
| Auth | Supabase Auth (email + password) | Email verification, password reset, JWT sessions built in |
| Authorization | Postgres **Row Level Security (RLS)** | Security enforced in the database, not the UI — solves the "hidden admin buttons" problem |
| File storage | Supabase Storage | Question images, bulk-upload files |
| Validation | Zod (shared schemas client + server) | One source of truth for input validation |
| State/data | TanStack Query (client) + Server Components (server) | Caching for test-taking UX |
| Payments (Phase 7) | PayPal Subscriptions API + webhooks | Per your requirement |
| Error monitoring | Sentry | Frontend + API error tracking |
| Testing | Vitest (unit) + Playwright (E2E) | Cover the test-engine and RLS rules |
| CI/CD | GitHub Actions → Vercel previews → production | Every PR gets a preview URL |

**Core architectural rules:**

1. **RLS-first security.** Every table has RLS enabled. The anon/authenticated Supabase client can only do what policies allow. Admin-only mutations go through Route Handlers using the `service_role` key **server-side only**, after verifying the caller's role.
2. **Server-side test integrity.** Timers, scoring, and answer correctness are computed on the server. The client never receives `is_correct` flags for an in-progress test.
3. **Append-only attempts log.** Every answered question writes one immutable row — this powers accuracy %, weak areas, streaks, and "most missed questions" without backfilling.
4. **Soft deletes** on questions (`deleted_at`) so historical results never break.

---

## 3. Project Structure

```
/app
  /(auth)          login, register, forgot-password, reset-password, verify
  /(app)           authenticated user area
    /dashboard
    /questions     question bank browser (+ [id] detail)
    /tests         new test wizard, /tests/[id]/take, /tests/[id]/results, /tests/[id]/review
    /bookmarks
    /account
  /(admin)/admin   guarded by role check in layout + RLS
    /questions     CRUD + bulk upload
    /users
    /subjects
    /analytics
    /pages         editable text content ("add text to pages")
  /api             route handlers: /api/tests/*, /api/admin/*, /api/webhooks/paypal
/lib               supabase clients (browser/server/admin), zod schemas, scoring.ts
/components        ui/, questions/, tests/, admin/
/supabase
  /migrations      SQL migrations (source of truth)
  seed.sql
/tests             unit + e2e
```

---

## 4. Database Schema (v1)

Run as Supabase migrations. Types abbreviated; all tables get `created_at timestamptz default now()`.

```sql
-- ENUMS
create type user_role as enum ('trial', 'student', 'admin');
create type question_type as enum ('mcq_single', 'mcq_multi', 'image_based');
create type difficulty as enum ('easy', 'medium', 'hard');
create type test_status as enum ('in_progress', 'submitted', 'abandoned');
create type sub_status as enum ('active', 'expired', 'cancelled');

-- PROFILES (1:1 with auth.users, created via trigger on signup)
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  role user_role not null default 'trial',
  trials_used int not null default 0,
  trials_limit int not null default 2,
  banned_at timestamptz,
  updated_at timestamptz default now()
);

-- CONTENT HIERARCHY
create table subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  position int not null default 0
);

create table topics (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects on delete cascade,
  name text not null,
  position int not null default 0,
  unique (subject_id, name)
);

-- QUESTIONS
create table questions (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references topics,
  type question_type not null default 'mcq_single',
  difficulty difficulty not null default 'medium',
  stem text not null,                    -- question text
  image_path text,                       -- Supabase Storage path (image_based)
  explanation text not null,
  is_published boolean not null default false,
  deleted_at timestamptz,                -- soft delete
  created_by uuid references profiles,
  updated_at timestamptz default now(),
  search_vec tsvector generated always as
    (to_tsvector('english', stem || ' ' || coalesce(explanation,''))) stored
);
create index questions_search_idx on questions using gin (search_vec);
create index questions_topic_idx on questions (topic_id) where deleted_at is null;

create table question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions on delete cascade,
  label text not null,
  is_correct boolean not null default false,
  position int not null default 0
);

-- TESTS
create table tests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles,
  status test_status not null default 'in_progress',
  config jsonb not null,                 -- {subject_ids, topic_ids, difficulty, num_questions, duration_sec}
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,       -- server-enforced deadline
  submitted_at timestamptz,
  score numeric,                         -- computed at submit
  total_questions int not null
);

create table test_questions (
  test_id uuid not null references tests on delete cascade,
  question_id uuid not null references questions,
  position int not null,
  option_order uuid[] not null,          -- shuffled option ids frozen per test
  primary key (test_id, question_id)
);

-- APPEND-ONLY ANSWERS LOG (powers all analytics)
create table attempts (
  id uuid primary key default gen_random_uuid(),
  test_id uuid references tests on delete cascade,  -- null = practice mode
  user_id uuid not null references profiles,
  question_id uuid not null references questions,
  selected_option_ids uuid[] not null default '{}',
  is_correct boolean not null,           -- computed server-side at submit
  time_spent_sec int,
  answered_at timestamptz not null default now(),
);
-- one final answer per question within a test; unlimited practice re-attempts
create unique index attempts_test_q_uidx on attempts (test_id, question_id) where test_id is not null;
create index attempts_user_idx on attempts (user_id, answered_at);
create index attempts_question_idx on attempts (question_id);

-- USER TOOLS
create table bookmarks (
  user_id uuid not null references profiles on delete cascade,
  question_id uuid not null references questions on delete cascade,
  primary key (user_id, question_id)
);

create table notes (
  user_id uuid not null references profiles on delete cascade,
  question_id uuid not null references questions on delete cascade,
  body text not null,
  updated_at timestamptz default now(),
  primary key (user_id, question_id)
);

-- CMS-ish editable page text ("add text to pages")
create table site_content (
  key text primary key,                  -- e.g. 'home.hero', 'faq.body'
  body text not null,
  updated_by uuid references profiles,
  updated_at timestamptz default now()
);

-- PAYMENTS (Phase 7)
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles,
  paypal_subscription_id text unique,
  plan text not null,                    -- 'monthly' | 'yearly'
  status sub_status not null,
  current_period_end timestamptz not null
);

create table payment_events (             -- raw webhook log (idempotency + audit)
  id uuid primary key default gen_random_uuid(),
  paypal_event_id text unique not null,
  type text not null,
  payload jsonb not null,
  processed_at timestamptz
);

-- ADMIN AUDIT LOG
create table audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles,
  action text not null,                  -- 'question.delete', 'user.reset_trials', ...
  target text,
  meta jsonb
);
```

**Auto-create profile on signup (trigger):**

```sql
create function public.handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, full_name) values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end; $$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

---

## 5. Row Level Security (the security backbone)

Enable RLS on **every** table. Helper:

```sql
create function public.is_admin() returns boolean as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$ language sql stable security definer;
```

Policy matrix (implement each as `create policy`):

| Table | select | insert | update | delete |
|---|---|---|---|---|
| profiles | own row, or admin | trigger only | own `full_name` only; admin all | admin |
| subjects/topics | any authenticated | admin | admin | admin |
| questions | published & not deleted (authenticated); admin sees all | admin | admin | admin (soft delete via update) |
| question_options | ⚠️ `is_correct` must NOT leak — expose options to users through a **view** (`question_options_public`) without `is_correct`; base table selectable by admin only | admin | admin | admin |
| tests | own rows; admin all | own (via server route) | server route only | — |
| test_questions | rows of own tests | server route | — | — |
| attempts | own rows; admin all | server route only | — (append-only) | — |
| bookmarks/notes | own | own | own (notes) | own |
| site_content | public read | admin | admin | admin |
| subscriptions | own; admin | webhook (service role) | webhook | — |
| audit_logs / payment_events | admin | service role | — | — |

**Critical detail:** answer correctness (`is_correct` on options) is only ever evaluated inside Route Handlers using the service-role client. The browser client literally cannot read it.

---

## 6. Core Flows (server-enforced)

### Test lifecycle
1. **Create** — `POST /api/tests`: validate config (Zod), check trial quota (`trials_used < trials_limit` for role `trial`; increment atomically), select N random published questions matching filters, shuffle options, insert `tests` + `test_questions`, set `expires_at = now() + duration`. Return questions **without** correct answers.
2. **Take** — client autosaves selections to `attempts` staging (or local state + periodic `PATCH /api/tests/[id]/answers` upsert with `is_correct` left for submit). Resume works because state lives server-side; refresh/crash loses nothing.
3. **Submit** — `POST /api/tests/[id]/submit`: reject if past `expires_at` grace (+30s network grace), score every answer server-side, write final `attempts` rows with `is_correct`, set `score`, `status='submitted'`.
4. **Auto-expiry** — a scheduled job (Supabase cron / pg_cron) marks overdue `in_progress` tests `abandoned` and scores whatever was saved.
5. **Review** — only for `submitted` tests: now the API returns correct options + explanations.

### Trial gating
- Middleware/layout checks `role`. Trial users: max 2 tests (`trials_used`), question bank browsing capped at 10 questions (enforced in the query with `limit` on the server, not the client).
- At limit → upgrade screen (Phase 7 wires payment; before that, "contact us").

### Analytics queries (all from `attempts`)
- Accuracy % = correct/total per user; per subject/topic via join through questions→topics.
- Weak areas = lowest accuracy topics with ≥5 attempts.
- Streak = consecutive days with ≥1 attempt (SQL window over `answered_at::date`).
- Admin "most missed" = group by question_id order by failure rate.

Implement these as **Postgres views or RPC functions** so dashboard pages are one query each.

---

## 7. Phased Delivery Plan

Estimates assume one full-time developer. Each phase ends deployable.

### Phase 0 — Foundations (2–3 days)
- Repo, Next.js + TS + Tailwind + shadcn/ui, ESLint/Prettier
- Supabase project (dev + prod), migration tooling (`supabase` CLI), seed script
- GitHub Actions: typecheck, lint, unit tests, Playwright smoke on PR; Vercel previews
- Sentry wired (client + server), env var management documented
- **Done when:** empty app deploys to prod URL from `main`; migrations apply cleanly to a fresh DB.

### Phase 1 — Auth, Roles, Accounts (4–5 days)
- Register (with email verification), login, logout, forgot/reset password
- Profile trigger, `profiles` RLS, banned-user check in middleware
- Route groups guarded: `(app)` requires session, `(admin)` requires `is_admin()`
- Rate limiting on auth endpoints (Vercel/Upstash) + Supabase's built-in throttling
- **Done when:** trial user cannot reach any `/admin` page or API even with hand-crafted requests; unverified email cannot log in.

### Phase 2 — Content Model & Admin Question CRUD (5–7 days)
- Subjects/topics management
- Question editor: MCQ single, multi-correct, image upload to Storage, explanation, difficulty, publish toggle, preview
- Soft delete + audit log entries on every admin mutation
- **Done when:** admin creates all 3 question types end-to-end; images render; unpublished questions invisible to students.

### Phase 3 — Question Bank (frontend) (4–5 days)  ← your current gap #4
- Browse by subject → topic, filters (difficulty, type), pagination
- Full-text search (`search_vec`)
- Question detail with "show answer + explanation" — practice mode logs an `attempts` row with `test_id = null`, so practice activity feeds the same analytics
- Bookmarks + personal notes
- Trial cap: 10 questions visible
- **Done when:** student finds a question by keyword, bookmarks it, adds a note, and sees the cap as a trial user.

### Phase 4 — Test Engine (7–10 days, highest risk)
- New-test wizard (subject, topics, count, difficulty, duration)
- Taking UI: question palette, flag-for-review, timer synced to `expires_at`, autosave, resume
- Server-side submit + scoring (unit-test the multi-correct scoring rule you choose — recommend all-or-nothing for v1)
- Auto-expiry cron
- **Done when:** Playwright test completes a full timed exam including a mid-test page refresh; tampering with client timer cannot extend a test.

### Phase 5 — Results, Review, Dashboard (5–6 days)
- Results page: score, %, time, per-topic breakdown
- Review mode: wrong answers with explanations
- Past tests list; dashboard stats (attempted, accuracy, streak, weak areas, trials used, account type)
- Analytics views/RPCs from §6
- **Done when:** numbers on the dashboard match hand-computed values from seeded attempts.

### Phase 6 — Admin Ops (5–7 days)
- User management: search, ban/unban, change role, reset trials, delete (cascade or anonymize)
- Bulk upload: CSV/XLSX (and .docx) → parse server-side → **validation report per row** → commit as drafts
- Admin analytics: user counts, tests taken, most-missed questions
- Editable `site_content` blocks
- **Done when:** a 200-row CSV with 5 bad rows imports 195 drafts and reports exactly the 5 failures.

### Phase 7 — Payments (PayPal) (6–8 days)
- Plans (monthly/yearly) via PayPal Subscriptions; hosted approval flow (no card data touches your app)
- Webhook handler: verify signature, idempotency via `payment_events`, activate/expire `subscriptions`, flip `role` trial↔student
- Expiry job: downgrade lapsed users; grace period (e.g., 3 days)
- Billing page: current plan, renewal date, cancel
- **Done when:** sandbox purchase upgrades an account within seconds of webhook delivery; cancelled sub downgrades at period end; replayed webhooks are no-ops.

### Phase 8 — Hardening & Launch (4–5 days)
- Accessibility pass (keyboard nav in test UI), mobile QA on real devices
- Load-test test-taking endpoints; add DB indexes surfaced by `pg_stat_statements`
- Terms of Service + Privacy Policy pages, cookie notice
- Backups verified (Supabase PITR on paid plan) + restore drill
- Security review: RLS test suite (attempt every forbidden action per role), dependency audit, security headers/CSP
- **Done when:** launch checklist below is 100%.

**Total: roughly 7–9 working weeks** for one developer, before payments ~5–6 weeks.

---

## 8. Testing Strategy

| Level | Tool | Must-cover |
|---|---|---|
| Unit | Vitest | scoring (single, multi, unanswered), streak calc, CSV parser/validator, Zod schemas |
| RLS | pgTAP or Vitest + per-role clients | every ✗ cell in the policy matrix actually fails |
| E2E | Playwright | register→verify→login; full timed test incl. refresh; trial cap; admin CRUD; bulk upload happy+error path |
| Manual | device pass | iOS Safari + Android Chrome test-taking |

CI blocks merge on all of the above except manual.

---

## 9. Environments, Secrets, Ops

- **Envs:** local (supabase CLI) → preview (branch DB or shared dev project) → production. Never point previews at prod DB.
- **Secrets:** `SUPABASE_SERVICE_ROLE_KEY`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `SENTRY_DSN` — server-only, set in Vercel; only `NEXT_PUBLIC_SUPABASE_URL` + anon key are public.
- **Monitoring:** Sentry alerts on API error rate; Supabase log drains; uptime check on `/api/health`.
- **Backups:** daily automated + point-in-time recovery; quarterly restore test.

---

## 10. Launch Checklist

- [ ] All RLS tests green against production schema
- [ ] Email deliverability: verification + reset emails from custom domain (SPF/DKIM)
- [ ] Rate limits on auth + test-creation endpoints
- [ ] `service_role` key absent from all client bundles (verify with build output scan)
- [ ] 404/500 pages, empty states, loading skeletons
- [ ] ToS + Privacy live; account-deletion path works
- [ ] Sentry receiving events from prod; alerting configured
- [ ] Backup restore drill completed
- [ ] Seeded content: ≥1 subject fully populated so first users see value
- [ ] Trial → upgrade funnel messaging in place (even pre-payments)

---

## 11. Risk Register

| Risk | Mitigation |
|---|---|
| Test engine state bugs (refresh, expiry, double-submit) | Server-authoritative state, idempotent submit, Playwright coverage first |
| Answer leakage to client | Options served via public view w/o `is_correct`; code-review rule: no service-role client in shared libs |
| Trial abuse via new accounts | Email verification required; optionally block disposable domains |
| Bulk upload garbage data | Draft-only imports + per-row validation report |
| PayPal webhook loss/duplication | `payment_events` idempotency table + PayPal signature verification + reconciliation cron |
| Scope creep | Phases 1–5 are the product; 6–8 make it operable; everything else is backlog |
