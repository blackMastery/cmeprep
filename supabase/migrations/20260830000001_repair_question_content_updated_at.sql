-- ── Repair: questions.content_updated_at missing despite 20260828000001 ──
-- Same drift 20260829000002 fixed for open_report_question_count: local
-- databases that ran db push while 20260828000001 was still being drafted
-- recorded the version before its later statements existed, and push never
-- revisits a recorded version. This restores the two remaining objects —
-- the content_updated_at column (with its backfill) and the resolved-side
-- index. IF NOT EXISTS + a null-guarded backfill keep it idempotent, so
-- environments that already have them are untouched. Bodies kept identical
-- to 20260828000001 — that file remains the reference.

alter table questions
  add column if not exists content_updated_at timestamptz;
update questions
  set content_updated_at = coalesce(updated_at, created_at)
  where content_updated_at is null;

create index if not exists question_reports_resolved_idx
  on question_reports (resolved_at desc)
  where resolved_at is not null;
