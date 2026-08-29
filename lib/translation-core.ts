import { dailyCapWindowStart } from "@/lib/analytics-core";
import type { TestMode, TestStatus } from "@/lib/supabase/types";

/**
 * Node-side face of the translation rules. The rules themselves live in
 * supabase/functions/_shared/translation-core.ts because the Edge Function
 * (Deno) must apply the very same registry, hash and prompt; this module
 * re-exports them for the app and adds the two rules only the app needs.
 * Pure — no `server-only` — so Client Components can read the registry and
 * vitest can pin everything.
 */
export * from "@/supabase/functions/_shared/translation-core";

/** The cap window's lower bound — the shared civil-day rule (Guyana). */
export function translationCapWindowStart(now: Date): string {
  return dailyCapWindowStart(now);
}

/**
 * Which translated answer-key fields may reach the client RIGHT NOW. The
 * translated explanation / model answer must obey exactly the rules the
 * English ones do: never mid-exam; tutor only for a revealed question; OSCE
 * only for a graded station; anything once the paper is finished. Stated
 * once here so the translate, reveal and grade routes and getTakeState can't
 * disagree — an exam-mode paper must always get {false, false}.
 */
export function revealFieldsAllowed(
  test: { mode: TestMode; status: TestStatus },
  revealed: boolean
): { explanation: boolean; modelAnswer: boolean } {
  if (test.status !== "in_progress") {
    return { explanation: true, modelAnswer: true };
  }
  if (test.mode === "tutor" && revealed) {
    return { explanation: true, modelAnswer: false };
  }
  if (test.mode === "osce" && revealed) {
    return { explanation: true, modelAnswer: true };
  }
  return { explanation: false, modelAnswer: false };
}
