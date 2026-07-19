-- Soft delete for question options.
--
-- Why this exists: `test_questions.option_order` and
-- `attempts.selected_option_ids` are uuid[] columns holding option ids from
-- tests users have already sat. Arrays cannot carry a foreign key, so
-- Postgres will happily let you delete an option and silently orphan them.
--
-- The damage is invisible: `lib/results.ts` resolves review options by id
-- from `option_order`, so a hard-deleted option simply vanishes from a
-- submitted paper — the student sees a 3-option question they answered as a
-- 4-option one, and if their pick was the deleted row, nothing is
-- highlighted while the score still says they got it wrong.
--
-- So the admin editor retires options instead of deleting them. New tests
-- filter `deleted_at is null`; historical reads resolve by id and still find
-- the row with its original label.

alter table public.question_options add column deleted_at timestamptz;

-- Partial index keeps the "live options for this question" lookup cheap,
-- which is the only shape the test builder and editor ever ask for.
create index question_options_active_idx
  on public.question_options (question_id) where deleted_at is null;

-- Recreate the client-facing view so retired options stop being served.
-- Column list is unchanged, so `create or replace` works and preserves the
-- existing grants (select to authenticated).
create or replace view public.question_options_public
  with (security_invoker = false, security_barrier = true) as
  select qo.id, qo.question_id, qo.label, qo.position
  from public.question_options qo
  join public.questions q on q.id = qo.question_id
  where q.is_published
    and q.deleted_at is null
    and qo.deleted_at is null;
