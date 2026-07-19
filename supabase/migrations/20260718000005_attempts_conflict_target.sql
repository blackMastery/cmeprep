-- Make the attempts upsert target a real conflict target.
--
-- The original index was partial:
--   create unique index attempts_test_q_uidx on attempts (test_id, question_id)
--     where test_id is not null;
--
-- Postgres will only use a partial index for ON CONFLICT if the statement
-- repeats the same WHERE predicate, which PostgREST's `on_conflict=` parameter
-- cannot express. The submit upsert therefore failed at runtime and, because
-- the error was unchecked, tests were marked `submitted` with a score while
-- writing zero `attempts` rows — silently emptying every analytic.
--
-- A plain unique constraint gives the semantics we actually want. Postgres
-- treats NULLs as distinct by default (NULLS DISTINCT), so practice-mode rows
-- (test_id is null) can still repeat freely for the same question, while any
-- given test keeps exactly one final answer per question.

drop index if exists attempts_test_q_uidx;

alter table attempts
  add constraint attempts_test_question_key unique (test_id, question_id);
