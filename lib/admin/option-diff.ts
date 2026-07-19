/**
 * Pure option-diffing for the question editor. Deliberately free of any
 * Supabase import so it can be unit-tested — this is the riskiest logic in
 * the admin area.
 */

export type ExistingOption = {
  id: string;
  label: string;
  is_correct: boolean;
  position: number;
  deleted_at: string | null;
};

export type SubmittedOption = {
  /** Present when editing an existing row, absent when newly added. */
  id?: string;
  label: string;
  isCorrect: boolean;
};

export type OptionRow = {
  id: string;
  question_id: string;
  label: string;
  is_correct: boolean;
  position: number;
  deleted_at: string | null;
};

export class OptionOwnershipError extends Error {
  constructor(readonly optionId: string) {
    super(`Option ${optionId} does not belong to this question`);
    this.name = "OptionOwnershipError";
  }
}

export type OptionDiff = {
  /** Upsert these — covers both updates and inserts. */
  rows: OptionRow[];
  /** Set deleted_at on these; never DELETE. */
  retireIds: string[];
};

/**
 * @param newId injected so tests are deterministic; defaults to randomUUID.
 */
export function diffOptions(
  questionId: string,
  existing: readonly ExistingOption[],
  submitted: readonly SubmittedOption[],
  newId: () => string = () => crypto.randomUUID()
): OptionDiff {
  const byId = new Map(existing.map((e) => [e.id, e]));

  // SECURITY: these ids come from a browser form and are about to be written
  // with the service-role client, which bypasses RLS entirely. Without this
  // check an admin could re-parent another question's option row, silently
  // corrupting a third question's frozen option_order. RLS will not catch it.
  for (const s of submitted) {
    if (s.id && !byId.has(s.id)) throw new OptionOwnershipError(s.id);
  }

  // Position is renumbered 0..n-1 in one pass. Safe because there is no
  // unique constraint on (question_id, position) — no swap dance needed.
  const rows: OptionRow[] = submitted.map((s, index) => ({
    id: s.id ?? newId(),
    question_id: questionId,
    label: s.label.trim(),
    is_correct: s.isCorrect,
    position: index,
    // Clearing this revives a row the admin removed and then re-added,
    // which preserves its id and so keeps historical papers intact.
    deleted_at: null,
  }));

  const kept = new Set(rows.map((r) => r.id));
  const retireIds = existing
    .filter((e) => !e.deleted_at && !kept.has(e.id))
    .map((e) => e.id);

  return { rows, retireIds };
}

/**
 * Did the correct-answer key change? Flipping correctness on a question that
 * has already been sat makes the review screen contradict the score the
 * student was given, so the editor confirms before allowing it.
 */
export function correctnessChanged(
  existing: readonly ExistingOption[],
  rows: readonly OptionRow[]
): boolean {
  const before = new Set(
    existing.filter((e) => !e.deleted_at && e.is_correct).map((e) => e.id)
  );
  const after = new Set(rows.filter((r) => r.is_correct).map((r) => r.id));

  if (before.size !== after.size) return true;
  for (const id of before) if (!after.has(id)) return true;
  return false;
}
