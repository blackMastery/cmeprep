-- Tutor mode: untimed practice sessions on the existing test scaffolding.
-- Each question grades + reveals its explanation immediately after answering
-- (POST /api/tests/[id]/reveal); the answer locks at that moment. Score is
-- correct/ANSWERED (not total) — answered_questions carries the denominator.

-- ── tests.mode ──────────────────────────────────────────────
-- text + check, NOT a pg enum — same deliberate choice as payments.status:
-- adding a mode later is a one-line check swap, not an enum migration.
alter table tests add column mode text not null default 'exam'
  check (mode in ('exam', 'tutor'));

-- ── untimed sessions ────────────────────────────────────────
-- Tutor sessions have no deadline and are resumable indefinitely — nothing
-- may ever "expire" or auto-abandon them (isExpired returns false on null).
-- The CHECK pins the invariant both ways: relaxing NOT NULL must not let an
-- exam row lose its deadline, and a tutor row must never gain one.
alter table tests alter column expires_at drop not null;
alter table tests add constraint tests_expires_at_by_mode check (
  (mode = 'tutor' and expires_at is null)
  or (mode <> 'tutor' and expires_at is not null)
);

-- Completion denominator, written at finalize for BOTH modes. History and
-- org reports need answered/total per row without an attempts join; for
-- tutor it is also what `score` was computed against. Null = legacy row
-- finalized before this column (or still in progress).
alter table tests add column answered_questions int
  check (answered_questions is null or answered_questions >= 0);

-- ── reveal lock ─────────────────────────────────────────────
-- Set once by the reveal endpoint (guarded update, never cleared): a revealed
-- answer is immutable — the answers PATCH skips these rows, and getTakeState
-- serves the graded truth from attempts, not from here. Carries no
-- correctness data, so it is safe under the existing client SELECT policy.
alter table test_answers add column revealed_at timestamptz;

-- ── exam vs tutor accuracy split ────────────────────────────
-- Dashboard shows both figures; weak areas / streaks deliberately stay
-- combined (subject_accuracy, user_daily_activity untouched). Legacy
-- practice rows (test_id null) count as 'exam' via coalesce.
create view public.user_mode_stats
  with (security_invoker = true) as
  select
    a.user_id,
    coalesce(t.mode, 'exam') as mode,
    count(*)::int as attempted,
    (count(*) filter (where a.is_correct))::int as correct,
    round(100.0 * (count(*) filter (where a.is_correct)) / count(*), 1) as accuracy_pct
  from attempts a
  left join tests t on t.id = a.test_id
  group by a.user_id, coalesce(t.mode, 'exam');

grant select on public.user_mode_stats to authenticated, service_role;
