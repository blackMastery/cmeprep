import type { QuestionType } from "@/lib/supabase/types";

/**
 * The rules a question must satisfy before it can go live.
 *
 * Deliberately pure and free of any Supabase import so both the single-row
 * `togglePublish` and the bulk publish action can share one definition — a
 * malformed question reaching students is the thing this prevents, and two
 * copies of the rule would eventually disagree.
 *
 * This is NOT the same check as `questionSchema` in lib/validation.ts. That one
 * validates the editor form (stem length, duplicate option text, …); this one
 * validates rows already in the database, where the only thing that matters is
 * whether the answer key can be scored.
 */
export type PublishCandidate = {
  type: QuestionType;
  image_path: string | null;
  /** Visible (not retired) options. */
  optionCount: number;
  /** Visible options marked correct. */
  correctCount: number;
  /** A question_model_answers row exists — OSCE's answer key. */
  hasModelAnswer: boolean;
};

/** Human-readable reason this question must not go live, or null if it may. */
export function publishBlocker(q: PublishCandidate): string | null {
  // OSCE's answer key is the model answer, not options — a published station
  // without one is ungradeable (the grade route 500s on it).
  if (q.type === "osce") {
    if (!q.hasModelAnswer)
      return "OSCE questions need a model answer before publishing.";
    return null;
  }

  const needsMulti = q.type === "mcq_multi";

  if (q.optionCount < 2) return "Add at least two options before publishing.";
  if (needsMulti && q.correctCount < 2)
    return "Multi-answer questions need at least two correct options.";
  if (!needsMulti && q.correctCount !== 1)
    return "Mark exactly one option correct before publishing.";
  if (q.type === "image_based" && !q.image_path)
    return "Image questions need an image before publishing.";

  return null;
}
