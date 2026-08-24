-- Assignments become editable (SPEC §7 "Editing"). updated_at is the
-- optimistic-concurrency token: updateAssignment re-reads the row, compares
-- the value the form was rendered with, and pins the UPDATE on it — two
-- org-admins editing the same assignment get "changed by someone else"
-- instead of last-write-wins. It also lets the member list say "updated"
-- when an assignment changed after it was first set (there is no
-- notification channel, so this is the only signal a moved deadline gets).
-- Backfilled to created_at so existing rows read as never edited.

alter table org_assignments
  add column if not exists updated_at timestamptz not null default now();
update org_assignments set updated_at = created_at;
