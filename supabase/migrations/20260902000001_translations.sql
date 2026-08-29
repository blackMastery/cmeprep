-- On-demand AI translation of question text.
--
-- A student presses "Translate" on ONE question; the Edge Function
-- (supabase/functions/translate-question) sends stem + options + explanation
-- (+ OSCE model answer) to OpenAI and the result is cached here forever, keyed
-- by (question, language). Nothing translates ahead of demand, so the bank is
-- never translated wholesale — only what students actually looked at.
--
-- Staleness is a HASH, not a timestamp: question_translations.source_hash is
-- sha256 of the exact source strings translated. questions.content_updated_at
-- would have been cheaper, but the bulk importer never stamps it and any
-- future writer that forgets to would silently serve a translation of text
-- that no longer exists. Readers recompute the hash and treat a mismatch as
-- "no translation" (the next click re-translates and overwrites).

-- ── Which languages the picker offers ─────────────────────────
-- The registry (codes, names, script, direction, prompt notes) lives in code:
-- supabase/functions/_shared/translation-core.ts. This table only says which
-- of those are switched ON. Public, non-sensitive: the marketing page reads it
-- logged-out to keep the schema.org availableLanguage claim honest.
create table translation_languages (
  code text primary key,
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by uuid references profiles on delete set null,
  updated_at timestamptz not null default now()
);
alter table translation_languages enable row level security;
create policy translation_languages_select on translation_languages
  for select using (true);
grant select on public.translation_languages to anon, authenticated;
grant select, insert, update, delete
  on public.translation_languages to service_role;

-- Spanish is the launch language.
insert into translation_languages (code, enabled, enabled_at)
  values ('es', true, now());

-- ── The cache ─────────────────────────────────────────────────
-- One row per (question, language) holding EVERY translated field: options
-- travel as {option_id: label} jsonb rather than a child table so a
-- translation is written and replaced atomically with its hash. Same
-- hard-revoked posture as question_model_answers: the explanation and model
-- answer inside are answer-key material, so a student may only ever see
-- these rows through the server libs that apply the mid-test withholding
-- rules (lib/tests.ts, lib/results.ts, the translate/reveal/grade routes).
create table question_translations (
  question_id uuid not null references questions on delete cascade,
  language text not null,
  stem text not null,
  options jsonb not null default '{}'::jsonb,
  explanation text not null,
  model_answer text,
  source_hash text not null,
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (question_id, language)
);
-- The admin coverage list: newest per language.
create index question_translations_language_updated_idx
  on question_translations (language, updated_at desc);
alter table question_translations enable row level security;
revoke all on public.question_translations from anon, authenticated;
grant select, insert, update, delete
  on public.question_translations to service_role;

-- ── Call log ──────────────────────────────────────────────────
-- One row per OpenAI call, INCLUDING failures (ok = false + error). Spend
-- tracking (tokens) counts every row; the two daily caps count only
-- STUDENT-triggered ok rows — the per-user cap for the user in the Guyana
-- day, the global circuit breaker across all students. Admin regenerates
-- (trigger = 'admin') are uncapped and feed neither: they are a manual,
-- audited click, not the abuse the caps exist for. Failed calls don't burn
-- cap either — the student was told to retry. user_id is SET NULL (not
-- cascade) so spend history outlives a deleted account.
create table translation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles on delete set null,
  test_id uuid references tests on delete set null,
  question_id uuid not null references questions,
  language text not null,
  -- Who asked: a student's button, or an admin regenerate.
  trigger text not null check (trigger in ('student', 'admin')),
  ok boolean not null,
  model text not null,
  prompt_tokens int,
  completion_tokens int,
  duration_ms int not null,
  error text,
  created_at timestamptz not null default now()
);
-- The per-user cap: user + created_at range scan.
create index translation_events_user_day_idx
  on translation_events (user_id, created_at);
-- The global cap and the spend strip: created_at range scan.
create index translation_events_day_idx
  on translation_events (created_at);
alter table translation_events enable row level security;
revoke all on public.translation_events from anon, authenticated;
grant select, insert, update, delete
  on public.translation_events to service_role;

-- ── "Request a language" ──────────────────────────────────────
-- One row per (user, language) — a second click is not a second vote. The
-- admin page shows the count next to each disabled language so you know
-- which one to switch on next.
create table language_requests (
  user_id uuid not null references profiles on delete cascade,
  language text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, language)
);
alter table language_requests enable row level security;
revoke all on public.language_requests from anon, authenticated;
grant select, insert, update, delete
  on public.language_requests to service_role;

-- ── Where the language is chosen and frozen ───────────────────
-- profiles.preferred_language seeds the new-test wizard (and the first
-- Translate click, when nothing is set yet); tests.language is the choice
-- frozen on the paper so take and review agree forever, whatever the profile
-- says later. Both are registry codes validated in app code, not FKs to
-- translation_languages: disabling a language must not orphan rows.
alter table profiles add column preferred_language text;
-- Self-serve, like full_name/credential_name: the column-level grant is the
-- enforcement (profiles_update_own limits the row).
grant update (preferred_language) on public.profiles to authenticated;

alter table tests add column language text;

-- ── "Translation is wrong" reports ────────────────────────────
-- Reuses question_reports (same queue, same triage) with a new category and
-- the language the student was reading, so the admin can jump straight to
-- Regenerate on the right row.
alter table question_reports add column language text;
alter table question_reports drop constraint question_reports_category_check;
alter table question_reports add constraint question_reports_category_check
  check (
    category is null or category in (
      'wrong_key', 'typo', 'outdated', 'ambiguous', 'image', 'translation', 'other'
    )
  );
