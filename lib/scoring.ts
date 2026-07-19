/**
 * Server-side scoring. Never import into a Client Component: correctness
 * data must not reach the browser before a test is submitted.
 *
 * Rule for multi-correct questions is ALL-OR-NOTHING (v1): the selection must
 * match the correct set exactly — no partial credit, no penalty.
 */

export type ScoredQuestion = {
  questionId: string;
  selectedOptionIds: string[];
  correctOptionIds: string[];
  isCorrect: boolean;
  answered: boolean;
};

export type TestScore = {
  total: number;
  correct: number;
  answered: number;
  unanswered: number;
  /** Percentage 0–100, rounded to one decimal. */
  percentage: number;
  questions: ScoredQuestion[];
};

/** Exact set equality, order-independent, duplicate-tolerant. */
export function isSelectionCorrect(
  selected: readonly string[],
  correct: readonly string[]
): boolean {
  // An empty selection is never correct, even for a question with no
  // correct options (which would be a content bug rather than a pass).
  if (selected.length === 0) return false;

  const selectedSet = new Set(selected);
  const correctSet = new Set(correct);

  if (selectedSet.size !== correctSet.size) return false;
  for (const id of correctSet) {
    if (!selectedSet.has(id)) return false;
  }
  return true;
}

/**
 * Restrict a question's correct-answer set to the options the test actually
 * froze in `test_questions.option_order`.
 *
 * Without this, editing a question mid-test corrupts scoring: adding a correct
 * option marks every in-flight student wrong on a choice they were never
 * shown (all-or-nothing needs exact set equality), and retiring one does the
 * same, since `is_correct` stays true on a soft-deleted row. The paper a
 * student sat is the frozen one, so that is what they are scored against.
 */
export function correctOptionsInTest(
  correctOptionIds: readonly string[],
  frozenOptionIds: readonly string[]
): string[] {
  const frozen = new Set(frozenOptionIds);
  return correctOptionIds.filter((id) => frozen.has(id));
}

export function scoreTest(
  questions: readonly {
    questionId: string;
    correctOptionIds: readonly string[];
  }[],
  answers: ReadonlyMap<string, readonly string[]>
): TestScore {
  const scored: ScoredQuestion[] = questions.map((q) => {
    const selected = answers.get(q.questionId) ?? [];
    return {
      questionId: q.questionId,
      selectedOptionIds: [...selected],
      correctOptionIds: [...q.correctOptionIds],
      isCorrect: isSelectionCorrect(selected, q.correctOptionIds),
      answered: selected.length > 0,
    };
  });

  const total = scored.length;
  const correct = scored.filter((q) => q.isCorrect).length;
  const answered = scored.filter((q) => q.answered).length;

  return {
    total,
    correct,
    answered,
    unanswered: total - answered,
    percentage: total === 0 ? 0 : Math.round((correct / total) * 1000) / 10,
    questions: scored,
  };
}

/**
 * Consecutive-day streak ending today (or yesterday — a day in progress
 * shouldn't reset a streak until it is actually missed).
 *
 * `days` are ISO date strings (YYYY-MM-DD) of days with >=1 attempt.
 */
export function calculateStreak(
  days: readonly string[],
  today: string
): number {
  if (days.length === 0) return 0;

  const set = new Set(days);
  const cursor = new Date(`${today}T00:00:00Z`);

  // Allow the streak to be anchored to yesterday if nothing is logged today.
  if (!set.has(toIsoDate(cursor))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (!set.has(toIsoDate(cursor))) return 0;
  }

  let streak = 0;
  while (set.has(toIsoDate(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Fisher-Yates. Returns a new array; does not mutate the input. */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
