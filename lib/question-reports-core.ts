import { dailyCapWindowStart } from "@/lib/analytics-core";
import type {
  QuestionReportCategory,
  QuestionReportResolution,
  QuestionType,
  TestStatus,
} from "@/lib/supabase/types";

/**
 * Pure rules for question reports (question-reports-spec.md). The DB/route
 * work lives in lib/question-reports.ts (student side) and
 * lib/admin/question-reports.ts (triage side); every rule they apply is
 * stated here once so vitest can cover it.
 */

export const REPORT_CATEGORIES: readonly QuestionReportCategory[] = [
  "wrong_key",
  "typo",
  "outdated",
  "ambiguous",
  "image",
  "other",
];

export const REPORT_CATEGORY_LABELS: Record<QuestionReportCategory, string> = {
  wrong_key: "Wrong answer key",
  typo: "Typo or wording",
  outdated: "Outdated guideline",
  ambiguous: "Ambiguous",
  image: "Image problem",
  other: "Something else",
};

export const REPORT_RESOLUTIONS: readonly QuestionReportResolution[] = [
  "fixed",
  "no_change",
  "not_actionable",
];

export const REPORT_RESOLUTION_LABELS: Record<QuestionReportResolution, string> = {
  fixed: "Fixed",
  no_change: "No change",
  not_actionable: "Not actionable",
};

/** Per user per civil day (Guyana midnight, like every other daily cap). */
export const REPORT_DAILY_CAP = 20;

/** Below this many distinct reporters a rate is noise; rank by count. */
export const REPORT_RATE_FLOOR = 5;

export const REPORT_NOTE_MAX = 1000;

/** The cap window's lower bound — the shared civil-day rule. */
export function reportCapWindowStart(now: Date): string {
  return dailyCapWindowStart(now);
}

/**
 * A test counts as in progress for report rules only while its clock runs.
 * Routes read tests.status directly (no finalizeIfExpired), so an expired
 * but not-yet-finalised paper must not keep the mid-test allowances open.
 */
export function effectiveTestStatus(
  test: { status: TestStatus; expires_at: string | null },
  now: Date
): TestStatus {
  if (
    test.status === "in_progress" &&
    test.expires_at !== null &&
    new Date(test.expires_at).getTime() <= now.getTime()
  ) {
    return "submitted";
  }
  return test.status;
}

/**
 * The results page offers a category + note for reports tapped bare during
 * THAT test; anything already categorised, or filed elsewhere, is left alone.
 */
export function needsElaboration(
  report: { testId: string | null; category: QuestionReportCategory | null },
  testId: string
): boolean {
  return report.testId === testId && report.category === null;
}

/** MCQ only: OSCE stations keep "Report this grade" and get no second
 * control. `image_based` is an MCQ with a picture. */
export function isReportableType(type: QuestionType): boolean {
  return type !== "osce";
}

/**
 * A category is required everywhere EXCEPT mid-test, where the control is a
 * single silent tap — pausing for a dialog would be a thinking-time exploit.
 * `null` test status means "no test" (a bookmark), where the dialog applies.
 */
export function categoryRequired(testStatus: TestStatus | null): boolean {
  return testStatus !== "in_progress";
}

/**
 * The mid-test tap TOGGLES so a mis-tap can be undone; after submit it is
 * final. Only the report filed from THIS in-progress test may be withdrawn,
 * and only while it is still bare — an elaborated report was a decision.
 */
export function canWithdraw(input: {
  testStatus: TestStatus | null;
  reportTestId: string | null;
  testId: string;
  category: QuestionReportCategory | null;
}): boolean {
  return (
    input.testStatus === "in_progress" &&
    input.reportTestId === input.testId &&
    input.category === null
  );
}

export type RollupInput = {
  questionId: string;
  reporters: number;
  attempts: number;
};

/** distinct reporters ÷ attempts, or null when there is nothing to divide by. */
export function reportRate(reporters: number, attempts: number): number | null {
  if (attempts <= 0) return null;
  return reporters / attempts;
}

/**
 * Ranking: by rate above the reporter floor, by reporter count below it.
 * Rate-ranking is what surfaces a freshly-imported broken question (8 in 20
 * sittings) above a long-lived one (15 in 5,000); the floor keeps a single
 * reporter on a brand-new question (1 in 1 = 100%) from topping the queue.
 * Every rated row outranks every floored row. Ties fall back to reporter
 * count, then to a stable id order so pagination never shuffles.
 */
export function rankRollups<T extends RollupInput>(rows: T[]): T[] {
  const key = (r: T) => {
    const rated = r.reporters >= REPORT_RATE_FLOOR;
    const rate = rated ? (reportRate(r.reporters, r.attempts) ?? 0) : 0;
    return { rated, rate };
  };
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka.rated !== kb.rated) return ka.rated ? -1 : 1;
    if (ka.rated && ka.rate !== kb.rate) return kb.rate - ka.rate;
    if (a.reporters !== b.reporters) return b.reporters - a.reporters;
    return a.questionId < b.questionId ? -1 : a.questionId > b.questionId ? 1 : 0;
  });
}

export type PickCount = {
  optionId: string;
  sinceEdit: boolean;
  picks: number;
};

export type OptionPick = {
  optionId: string;
  label: string;
  isCorrect: boolean;
  picks: number;
  /** Of attempts on that side of the edit; 0 when there were none. */
  percent: number;
};

export type PickSplit = {
  since: { attempts: number; options: OptionPick[] };
  before: { attempts: number; options: OptionPick[] };
};

/**
 * What everyone actually picked, split at the question's last edit. All-time
 * alone would make a corrected question look permanently broken; the split
 * is how you see a fix land. Options are listed in the question's own order
 * (retired ones too, if anyone ever picked them — they are the history).
 */
export function splitPicks(
  options: { id: string; label: string; isCorrect: boolean }[],
  picks: PickCount[],
  attempts: { sinceEdit: number; beforeEdit: number }
): PickSplit {
  const build = (side: boolean, denominator: number) => {
    const byOption = new Map<string, number>();
    for (const p of picks) {
      if (p.sinceEdit !== side) continue;
      byOption.set(p.optionId, (byOption.get(p.optionId) ?? 0) + p.picks);
    }
    return {
      attempts: denominator,
      options: options.map((o) => {
        const n = byOption.get(o.id) ?? 0;
        return {
          optionId: o.id,
          label: o.label,
          isCorrect: o.isCorrect,
          picks: n,
          percent: denominator > 0 ? Math.round((n / denominator) * 100) : 0,
        };
      }),
    };
  };
  return {
    since: build(true, attempts.sinceEdit),
    before: build(false, attempts.beforeEdit),
  };
}

/**
 * The ruling to carry forward when a resolved question is reported again:
 * the most recent resolution on the question. `no_change` is the valuable
 * one — the admin re-examines rather than re-derives, and a wrong "no
 * change" can still be corrected when 40 more people disagree.
 */
export function lastRuling<
  T extends { resolved_at: string | null; resolution: QuestionReportResolution | null }
>(history: T[]): T | null {
  let best: T | null = null;
  for (const r of history) {
    if (!r.resolved_at || !r.resolution) continue;
    if (!best || r.resolved_at > best.resolved_at!) best = r;
  }
  return best;
}
