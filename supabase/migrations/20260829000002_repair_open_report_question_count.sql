-- ── Repair: open_report_question_count missing despite 20260828000001 ──
-- Local databases that ran db push while that migration was still being
-- drafted recorded the version with only two of its three functions, and
-- push never revisits a recorded version. CREATE OR REPLACE + re-grant is
-- idempotent, so environments that already have the function are untouched.
-- Body kept identical to 20260828000001 — that file remains the reference.
create or replace function open_report_question_count(p_org_id uuid default null)
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

revoke all on function open_report_question_count(uuid)
  from public, anon, authenticated;
grant execute on function open_report_question_count(uuid) to service_role;
