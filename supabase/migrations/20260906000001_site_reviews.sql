-- Product reviews / testimonials.
--
-- The subject is the PRODUCT, not a question, a course or an exam — there is
-- deliberately no subject FK. Named site_reviews, not reviews: "review"
-- already means ANSWER review everywhere else in this app
-- (app/(app)/tests/[id]/review, lib/results.ts). Only the public URL and the
-- user-facing copy say "reviews".
--
-- Pre-moderated: nothing is public until an admin approves it, and the author
-- has no control after submit — no edit, no withdraw, no notification.
-- Everything from display_name down to exam_name is a SNAPSHOT taken at
-- submit time and never re-read, so a published quote cannot change meaning
-- after the fact (a rename, a lapsed subscription, a deleted exam).

create table site_reviews (
  id uuid primary key default gen_random_uuid(),

  -- SET NULL, not cascade: the review is a published statement about the
  -- product and outlives the account, exactly like contact_messages. The
  -- publication licence (consent_at) is what makes keeping it defensible.
  -- This is also why the one-per-user unique index below is partial.
  user_id uuid references profiles on delete set null,

  rating int not null check (rating between 1 and 5),

  -- PLAIN TEXT, never markdown: this renders on the marketing pages, where
  -- the only thing worse than no testimonials is one that injects markup.
  -- Both bounds are restated here as a backstop against a direct
  -- service-role write; the message a human sees comes from
  -- reviewBodyIssue() in lib/site-reviews-core.ts.
  body text not null check (char_length(body) between 40 and 1000),

  -- ── attribution snapshot ─────────────────────────────────
  -- profiles.full_name at submit time. Frozen because profiles is NOT
  -- readable by anon (20260718000003_rls.sql:22-23), so a join at render is
  -- impossible on the marketing pages — and because a later rename must not
  -- silently re-attribute a quote we already published.
  display_name text not null check (char_length(display_name) between 1 and 80),

  -- ── verification snapshot ────────────────────────────────
  -- "Has this person ever paid us", as of submit time. Deliberately NOT
  -- examAccessFor/canAccessExam: those are time-sensitive, so a badge derived
  -- from them would quietly vanish the day a subscription lapsed.
  verified_purchase boolean not null,

  -- Their role at submit time. text + check, not the user_role enum: this is
  -- a snapshot, and it must not be dragged along by a future enum change.
  role_at_submit text not null
    check (role_at_submit in ('trial', 'student', 'admin')),

  -- The exam they had actually practised most (pickPrimaryExam), by id AND by
  -- name. The name keeps the row self-contained after an exam rename or
  -- delete; the id is only ever an admin filter. NOT displayed publicly in
  -- v1. Null when they had never answered a question.
  exam_id uuid references exams on delete set null,
  exam_name text check (exam_name is null or char_length(exam_name) <= 120),

  -- ── consent ──────────────────────────────────────────────
  -- Stamped from the publication-licence checkbox on the form. not null on
  -- purpose: there is no path that writes a review without the licence, and a
  -- nullable column would invite one.
  consent_at timestamptz not null,

  -- ── moderation ───────────────────────────────────────────
  -- text + check, NOT a pg enum (payments/tests precedent): adding a state to
  -- a check constraint is not a lock.
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),

  -- No rejection reason is recorded anywhere, by design: the author is never
  -- told, so a reason would be a private note with no reader. The audit_logs
  -- row (site_review.reject) is the whole account of a verdict.
  moderated_at timestamptz,
  moderated_by uuid references profiles on delete set null,
  -- Keeps the columns in step: a moderated row always says when, a pending
  -- one never does. Same shape as question_reports' resolved check.
  check ((moderated_at is null) = (status = 'pending')),

  -- The marketing pull-quotes (home + pricing). A featured row is BY
  -- DEFINITION a published one; this constraint is what stops a reject from
  -- leaving a rejected quote on the home page. The moderation action clears
  -- the flag itself, so the constraint stays a backstop rather than an error
  -- path a moderator can reach.
  featured boolean not null default false,
  check (not featured or status = 'approved'),

  created_at timestamptz not null default now(),
  -- Hand-written by the moderation actions. No triggers exist in this repo.
  updated_at timestamptz
);

-- One review per person, EVER — rejected ones included: re-submitting past a
-- rejection is exactly the abuse this prevents. UNLIKE question_reports, the
-- route answers a 23505 here with 409, not success: the student's 1000
-- characters were discarded, so "thanks" would be a lie.
--
-- Partial because user_id goes null on account deletion and those orphans
-- must not collide (Postgres already treats NULLs as distinct; the predicate
-- says so out loud and keeps the index to live authors).
--   select id from site_reviews where user_id = $1          (hasReviewed)
create unique index site_reviews_user_uidx
  on site_reviews (user_id)
  where user_id is not null;

-- Everything the admin queue and every public list needs. Serves both scan
-- directions, so the pending queue is FIFO and the rest is newest-first:
--   ... where status = 'pending'  order by created_at asc   (the queue)
--   select count(*) ... where status = 'pending'            (sidebar badge)
--   ... where status = 'approved' order by created_at desc  (/reviews)
--   select count(*) ... where status = 'approved'           (the public gate)
-- A separate pending-only index is deliberately NOT added: this one already
-- covers the queue in both directions, and the admin "All" tab sorts a few
-- hundred rows.
create index site_reviews_status_idx
  on site_reviews (status, created_at desc);

-- The home + pricing pull-quotes. A handful of rows on the hottest page in
-- the app, so it gets its own partial index rather than a filter on top of
-- the one above.
--   ... where featured and status = 'approved' order by created_at desc
create index site_reviews_featured_idx
  on site_reviews (created_at desc)
  where featured and status = 'approved';

-- The rating histogram (site_review_rating_counts below). Narrow and partial
-- so the aggregate never touches the heap — bodies are up to 1 KB each and
-- this runs on every marketing page render.
--   select rating, count(*) ... where status = 'approved' group by rating
create index site_reviews_rating_idx
  on site_reviews (rating)
  where status = 'approved';

-- ── Why there is no public read ──────────────────────────────
--
-- plans and site_content grant `select` to anon because every column of those
-- rows IS the marketing copy. A review row is not: it carries user_id, the
-- moderation state, the consent stamp and the role snapshot. A
-- `for select using (status = 'approved')` policy would publish all of them
-- for every approved row — plus any column added later, silently.
--
-- And nothing in a browser needs to read this table. /reviews, the home band,
-- the pricing rail and the JSON-LD are all Server Components on pages that
-- are ALREADY per-request dynamic (they read cookies via
-- lib/supabase/server.ts), so they read through lib/site-reviews.ts with the
-- service-role client and select the display columns BY NAME. The
-- `status = 'approved'` filter therefore lives in exactly one place rather
-- than two that can drift.
--
-- If a Client Component ever needs these rows (a "load more", a widget), add
-- a site_reviews_public VIEW on the question_options_public model —
-- security_barrier, display columns only, `where status = 'approved'`,
-- granted to anon — and NOT a policy on the base table.
alter table site_reviews enable row level security;
revoke all on public.site_reviews from anon, authenticated;
grant select, insert, update, delete on public.site_reviews to service_role;

-- ── Approved-review rating histogram ─────────────────────────
--
-- At most five rows, whatever the volume.
--
-- NOT `select rating from site_reviews where status = 'approved'` in the app:
-- PostgREST caps a response at max_rows = 1000 (supabase/config.toml), so
-- past a thousand reviews that query would silently truncate and the average
-- on the home page would be wrong forever with nothing to notice.
--
-- NOT `avg()` in SQL either: the average, the half-up rounding and the
-- cold-start gate (REVIEWS_PUBLIC_MIN, currently one approved review) are
-- PRODUCT rules, and they live in
-- lib/site-reviews-core.ts where vitest covers them. This returns counts and
-- nothing else.
create function site_review_rating_counts()
returns table (rating int, reviews bigint)
language sql
stable
set search_path = public
as $$
  select r.rating, count(*)::bigint
  from site_reviews r
  where r.status = 'approved'
  group by r.rating
$$;

-- No `security definer`, unlike the question-report functions: only the
-- service role calls this and it already bypasses RLS, so definer would add a
-- privilege the function does not use.
revoke all on function site_review_rating_counts() from public, anon, authenticated;
grant execute on function site_review_rating_counts() to service_role;
