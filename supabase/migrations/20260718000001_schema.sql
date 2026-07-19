-- CME Prep — core schema (v1)
-- Source of truth: exam-app-development-plan.md §4 (with fixes:
-- attempts trailing-comma bug removed; test_answers staging table added
-- so `attempts` stays append-only with NOT NULL is_correct).

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
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

-- CONTENT HIERARCHY
create table subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table topics (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
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
  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),
  search_vec tsvector generated always as
    (to_tsvector('english', stem || ' ' || coalesce(explanation, ''))) stored
);
create index questions_search_idx on questions using gin (search_vec);
create index questions_topic_idx on questions (topic_id) where deleted_at is null;

create table question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions on delete cascade,
  label text not null,
  is_correct boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index question_options_question_idx on question_options (question_id);

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
  total_questions int not null,
  created_at timestamptz not null default now()
);
create index tests_user_idx on tests (user_id, started_at desc);

create table test_questions (
  test_id uuid not null references tests on delete cascade,
  question_id uuid not null references questions,
  position int not null,
  option_order uuid[] not null,          -- shuffled option ids frozen per test
  primary key (test_id, question_id)
);

-- IN-PROGRESS ANSWER STAGING (autosave/resume state; wiped semantics stay
-- simple because final answers live in `attempts`)
create table test_answers (
  test_id uuid not null references tests on delete cascade,
  question_id uuid not null references questions,
  selected_option_ids uuid[] not null default '{}',
  flagged boolean not null default false,
  time_spent_sec int not null default 0,
  updated_at timestamptz not null default now(),
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
  answered_at timestamptz not null default now()
);
-- one final answer per question within a test; unlimited practice re-attempts
create unique index attempts_test_q_uidx on attempts (test_id, question_id) where test_id is not null;
create index attempts_user_idx on attempts (user_id, answered_at);
create index attempts_question_idx on attempts (question_id);

-- USER TOOLS
create table bookmarks (
  user_id uuid not null references profiles on delete cascade,
  question_id uuid not null references questions on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create table notes (
  user_id uuid not null references profiles on delete cascade,
  question_id uuid not null references questions on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),
  primary key (user_id, question_id)
);

-- CMS-ish editable page text
create table site_content (
  key text primary key,                  -- e.g. 'home.hero', 'faq.body'
  body text not null,
  updated_by uuid references profiles,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

-- PAYMENTS (Phase 7 — schema landed early so RLS ships complete)
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles,
  paypal_subscription_id text unique,
  plan text not null,                    -- 'monthly' | 'quarterly'
  status sub_status not null,
  current_period_end timestamptz not null,
  created_at timestamptz not null default now()
);

create table payment_events (            -- raw webhook log (idempotency + audit)
  id uuid primary key default gen_random_uuid(),
  paypal_event_id text unique not null,
  type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ADMIN AUDIT LOG
create table audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles,
  action text not null,                  -- 'question.delete', 'user.reset_trials', ...
  target text,
  meta jsonb,
  created_at timestamptz not null default now()
);
