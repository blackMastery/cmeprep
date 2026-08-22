-- Question reports (question-reports-spec.md).
--
-- Students tell us an MCQ is broken; admins triage per QUESTION, not per
-- report. The table is one row per (user, question) complaint; the admin
-- queue rolls those up and "resolving" stamps every open row on a question
-- at once. Nothing here is ever deleted by an admin — resolved rows are the
-- memory the reopen rule ("carry the last ruling forward") depends on. The
-- one sanctioned delete is the student undoing their own mis-tap while the
-- test that produced it is still in progress (the route enforces that).
--
-- NOT a column on questions, and NOT test_answers.flagged: that flag is a
-- private "come back to this" bookmark no admin surface reads.

create table question_reports (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions,
  -- Cascade like bookmarks/notes: a deleted account takes its reports with
  -- it rather than blocking the delete on an FK.
  user_id uuid not null references profiles on delete cascade,
  -- Where the student met the question. Null for reports filed from
  -- /bookmarks; set null if the test is ever removed so the report survives.
  test_id uuid references tests on delete set null,
  -- Null = a bare mid-test tap (no dialog mid-exam: the clock doesn't stop).
  -- Elaborated at results, or never — a bare flag still counts.
  category text check (
    category is null or category in (
      'wrong_key', 'typo', 'outdated', 'ambiguous', 'image', 'other'
    )
  ),
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  -- Resolution is an OUTCOME, not a timestamp: `no_change` is the ruling a
  -- re-report reopens against. The CHECK keeps the three columns in step —
  -- a resolved row always says how, an open row never does.
  resolved_at timestamptz,
  resolved_by uuid references profiles on delete set null,
  resolution text check (
    resolution is null or resolution in ('fixed', 'no_change', 'not_actionable')
  ),
  resolution_note text check (
    resolution_note is null or char_length(resolution_note) <= 1000
  ),
  check ((resolved_at is null) = (resolution is null))
);

-- One OPEN report per user per question. Partial, so resolving reopens the
-- channel: a complaint about the FIXED version is new information, and a
-- permanent silence would hide a bad fix. The route answers a 23505 here as
-- success — the student's goal (it's flagged) is already met.
create unique index question_reports_open_uidx
  on question_reports (user_id, question_id)
  where resolved_at is null;

-- The rollup: open reports grouped by question.
create index question_reports_open_question_idx
  on question_reports (question_id)
  where resolved_at is null;

-- Per-question history (the editor) and the "last ruling" lookup.
create index question_reports_question_idx
  on question_reports (question_id, created_at desc);

-- The 20-per-day cap.
create index question_reports_user_day_idx
  on question_reports (user_id, created_at desc);

-- The resolved view: newest ruling first. Resolved rows are kept forever,
-- so this side only grows.
create index question_reports_resolved_idx
  on question_reports (resolved_at desc)
  where resolved_at is not null;

alter table question_reports enable row level security;
revoke all on public.question_reports from anon, authenticated;
grant select, insert, update, delete on public.question_reports to service_role;

-- ── "Last edit" is a CONTENT edit ──────────────────────────
--
-- questions.updated_at is stamped by publish toggles, soft-deletes and
-- no-op saves too, so it cannot be the pick-split boundary: an unpublish
-- on Friday would wipe the evidence that Monday's key fix landed. This
-- column is stamped only when stem/options/explanation/image change
-- (saveQuestion's update path) and is backfilled from the old stamp.
alter table questions
  add column content_updated_at timestamptz;
update questions set content_updated_at = coalesce(updated_at, created_at);

-- ── Evidence: what everyone actually picked, split at the last edit ──
--
-- Aggregated in SQL rather than pulled row-by-row: one long-lived question
-- can carry thousands of attempts, and the queue shows dozens of questions.
-- Both functions are bounded to the ids passed in (the reported set), walk
-- attempts_question_idx, and are counted LIVE on purpose —
-- analytics_question_stats is recomputed nightly, so a question imported
-- today would rank on attempts_count = 0, which is exactly the case the
-- rate ranking exists to catch.

-- Denominators: attempts per question on each side of the edit, plus the
-- distinct-reporter-rate denominator (all attempts).
create function question_report_attempt_counts(question_ids uuid[])
returns table (
  question_id uuid,
  attempts bigint,
  since_edit bigint,
  before_edit bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.question_id,
    count(*)::bigint as attempts,
    (count(*) filter (
      where a.answered_at >= coalesce(q.content_updated_at, q.created_at)
    ))::bigint as since_edit,
    (count(*) filter (
      where a.answered_at < coalesce(q.content_updated_at, q.created_at)
    ))::bigint as before_edit
  from attempts a
  join questions q on q.id = a.question_id
  where a.question_id = any(question_ids)
  group by a.question_id
$$;

-- Numerators: picks per option on each side of the edit. A multi-select
-- attempt contributes one row per option it picked, so percentages are
-- "of attempts that picked this", which is the honest reading for a key.
create function question_report_pick_counts(question_ids uuid[])
returns table (
  question_id uuid,
  option_id uuid,
  since_edit boolean,
  picks bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.question_id,
    o.option_id,
    a.answered_at >= coalesce(q.content_updated_at, q.created_at) as since_edit,
    count(*)::bigint as picks
  from attempts a
  join questions q on q.id = a.question_id
  cross join lateral unnest(a.selected_option_ids) as o(option_id)
  where a.question_id = any(question_ids)
  group by a.question_id, o.option_id, 3
$$;

-- The nav badge: distinct reported QUESTIONS with something open, scoped to
-- one org's bank (or the whole platform when p_org_id is null). One integer
-- from an index-only scan of question_reports_open_question_idx, instead of
-- every open row shipped to Node — which PostgREST's max_rows would have
-- silently truncated at 1000 anyway.
create function open_report_question_count(p_org_id uuid default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct r.question_id)::int
  from question_reports r
  join questions q on q.id = r.question_id
  join subjects s on s.id = q.subject_id
  join specialties sp on sp.id = s.specialty_id
  join exams e on e.id = sp.exam_id
  where r.resolved_at is null
    and (p_org_id is null or e.org_id = p_org_id)
$$;

-- security definer reads attempts across users; only the service role may
-- call them, and the callers verify the admin/org author first.
revoke all on function question_report_attempt_counts(uuid[])
  from public, anon, authenticated;
revoke all on function question_report_pick_counts(uuid[])
  from public, anon, authenticated;
revoke all on function open_report_question_count(uuid)
  from public, anon, authenticated;
grant execute on function question_report_attempt_counts(uuid[]) to service_role;
grant execute on function question_report_pick_counts(uuid[]) to service_role;
grant execute on function open_report_question_count(uuid) to service_role;
