-- Tutor answers get rated, not just reported.
--
-- tutor_answer_reports modelled one signal: "this answer was bad". A rating
-- pair is strictly more useful for a strict-RAG tutor — a thumbs-up says the
-- retrieved passages actually answered the question, which is the thing
-- MIN_SCORE and the chunking are tuned against, and there is no other source
-- of that signal. So the table becomes feedback and carries the verdict.

alter table tutor_answer_reports rename to tutor_answer_feedback;

-- Every existing row was a complaint, so the default backfills them correctly.
-- Dropped afterwards: a rating is the whole point of the row, and letting it
-- default would silently record "bad" for a caller that forgot to send one.
alter table tutor_answer_feedback
  add column rating text not null default 'down'
    check (rating in ('up', 'down'));
alter table tutor_answer_feedback alter column rating drop default;

-- Names follow the table. `alter table ... rename` renames NEITHER the indexes
-- nor the constraints, and the foreign-key names in particular are load-bearing:
-- this table has two FKs to profiles, so the admin query must disambiguate its
-- embed by constraint name (`profiles!tutor_answer_feedback_user_id_fkey`) or
-- PostgREST rejects the request. Leaving them on the old name would break that
-- query — the same failure the osce_grade_reports embed hit.
alter index tutor_answer_reports_open_idx
  rename to tutor_answer_feedback_open_idx;
alter index tutor_answer_reports_message_idx
  rename to tutor_answer_feedback_message_idx;

-- Index-backed constraints rename with the constraint, not the index.
alter table tutor_answer_feedback
  rename constraint tutor_answer_reports_pkey to tutor_answer_feedback_pkey;
-- Referenced by its COLUMNS in the upsert (onConflict: "user_id,message_id"),
-- never by name, so renaming it is safe.
alter table tutor_answer_feedback
  rename constraint tutor_answer_reports_user_id_message_id_key
  to tutor_answer_feedback_user_id_message_id_key;

alter table tutor_answer_feedback
  rename constraint tutor_answer_reports_user_id_fkey
  to tutor_answer_feedback_user_id_fkey;
alter table tutor_answer_feedback
  rename constraint tutor_answer_reports_handled_by_fkey
  to tutor_answer_feedback_handled_by_fkey;
alter table tutor_answer_feedback
  rename constraint tutor_answer_reports_message_id_fkey
  to tutor_answer_feedback_message_id_fkey;
alter table tutor_answer_feedback
  rename constraint tutor_answer_reports_note_check
  to tutor_answer_feedback_note_check;

-- The admin queue triages the bad ones first; positive feedback is read as a
-- whole, not worked through, so only this filter needs an index.
create index tutor_answer_feedback_down_idx
  on tutor_answer_feedback (rating, handled_at nulls first, created_at desc);

-- RLS and privileges carry across a rename, but restate the grant so a reader
-- of this file sees the table is service-role only, like every tutor table.
grant select, insert, update, delete on public.tutor_answer_feedback to service_role;
