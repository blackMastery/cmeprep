/**
 * Pure study-plan rules (SPEC §17): weekly goal generation, progress
 * evaluation and adherence.
 *
 * Pure so vitest can pin every branch — the DB-touching layer is lib/plan.ts.
 * Weeks are ISO Mondays in America/Guyana civil time, shared with readiness
 * via mondayOf/guyanaDay (lib/orgs-core.ts). Goals are generated ONCE per
 * week and frozen (study_plan_weeks); only progress moves after that, so a
 * mid-week accuracy change can never rewrite what the student was told to do.
 */

import { dayDiff } from "@/lib/orgs-core";
import type {
  PlanGoal,
  PlanGoalsDoc,
} from "@/lib/validation";
import type { PlanIntensity, TestMode } from "@/lib/supabase/types";

export type { PlanGoal, PlanGoalsDoc };

/** Weekly targets per intensity. Mock cadence is in weeks (2 = biweekly). */
export const PLAN_INTENSITY_TARGETS = {
  light: { questions: 60, focusSubjects: 2, mockEveryWeeks: 2 },
  standard: { questions: 120, focusSubjects: 3, mockEveryWeeks: 1 },
  intense: { questions: 200, focusSubjects: 4, mockEveryWeeks: 1 },
} as const satisfies Record<
  PlanIntensity,
  { questions: number; focusSubjects: number; mockEveryWeeks: number }
>;

/** Questions per prescribed focus session (clamped to the subject's bank). */
export const SESSION_QUESTIONS = 20;
/** A tutor test must put at least this many attempts into the subject to
 * count as one focus session — else three clicks would tick the goal. */
export const SESSION_MIN_ATTEMPTS = 10;
/** Share of a plan-launched focus session seeded from the retry pool. */
export const RETRY_SEED_RATIO = 0.3;
/** Prescribed mock size per intensity (clamped to the bank). */
export const MOCK_QUESTIONS = {
  light: 30,
  standard: 50,
  intense: 50,
} as const satisfies Record<PlanIntensity, number>;
/** Any submitted exam-mode test at least this big satisfies the mock goal —
 * attribution is activity-based, self-built mocks count. */
export const MOCK_MIN_QUESTIONS = 20;
/** Below this many all-time attempts the first goal is a diagnostic mock.
 * Numerically equal to READINESS_MIN_ATTEMPTS but a separate concern — the
 * two thresholds may drift apart deliberately. */
export const DIAGNOSTIC_MIN_ATTEMPTS = 20;
/** A subject with fewer attempts is a coverage gap — prescribed before any
 * weak-subject optimisation. Mirrors COVERAGE_MIN_SUBJECT_ATTEMPTS. */
export const COVERAGE_GAP_ATTEMPTS = 5;
/** Focus subjects need at least this many published questions — the launch
 * route and goal schema both floor sessions at 5 questions. */
export const FOCUS_MIN_QUESTIONS = 5;
/** Volume ramps inside the final weeks before a known sitting date. */
export const RAMP_FINAL_WEEKS = 4;
export const RAMP_CLOSE_WEEKS = 2;
/** Adherence = goal completion over this many completed weeks. */
export const ADHERENCE_WEEKS = 4;
/** Mocks stay biweekly for the first generated weeks at any intensity —
 * new planners get room to build coverage before timed pressure ramps. */
export const EARLY_WEEKS = 2;

export type PlanSubjectStat = {
  subjectId: string;
  subjectName: string;
  /** Published question count (exam_subject_counts). */
  questionCount: number;
  attempts: number;
  accuracyPct: number | null;
};

export type GenerateWeekInput = {
  /** Monday (YYYY-MM-DD) of the week being generated. */
  weekStart: string;
  intensity: PlanIntensity;
  /** Whole weeks until the sitting; null = no date known (steady cadence). */
  weeksToExam: number | null;
  /** FULL exam subject roster, untouched subjects zero-filled. */
  subjects: PlanSubjectStat[];
  /** Per-exam all-time attempts (user_exam_stats). */
  allTimeAttempts: number;
  /** week_start of the most recent PRIOR week whose doc contains a mock
   * goal; null = none ever prescribed. */
  lastMockGoalWeekStart: string | null;
  /** How many prior weeks exist for this (user, exam) — the early-weeks rule. */
  priorWeekCount: number;
  diagnosticDismissed: boolean;
};

/** Whole weeks from a reference day to the sitting; null when there is no
 * date or it has already passed (a past sitting must not ramp forever).
 * Callers pass TODAY (guyanaDay(now)), not the week's Monday — a Tuesday
 * sitting must read as passed when the week generates on Friday. */
export function weeksToExam(
  sittingOn: string | null,
  fromDay: string
): number | null {
  if (sittingOn === null) return null;
  const days = dayDiff(sittingOn, fromDay);
  return days < 0 ? null : Math.ceil(days / 7);
}

export function shouldPrescribeDiagnostic(
  allTimeAttempts: number,
  dismissed: boolean
): boolean {
  return allTimeAttempts < DIAGNOSTIC_MIN_ATTEMPTS && !dismissed;
}

/** Is a mock goal due this week, given when one was last prescribed? */
export function mockDue(
  lastMockGoalWeekStart: string | null,
  weekStart: string,
  everyWeeks: number
): boolean {
  if (lastMockGoalWeekStart === null) return true;
  return dayDiff(weekStart, lastMockGoalWeekStart) >= everyWeeks * 7;
}

/** How many of a focus session's questions come from the retry pool. */
export function retrySeedCount(numQuestions: number): number {
  return Math.ceil(numQuestions * RETRY_SEED_RATIO);
}

const rampMultiplier = (wte: number | null): number => {
  if (wte === null) return 1;
  if (wte <= RAMP_CLOSE_WEEKS) return 1.5;
  if (wte <= RAMP_FINAL_WEEKS) return 1.25;
  return 1;
};

export const focusGoalId = (subjectId: string): string => `focus:${subjectId}`;

/**
 * Generate one week's goals. Deterministic: same input, same doc — ties in
 * the subject ranking break by name then id so reruns can't reshuffle.
 *
 * Order of rules: diagnostic decision → coverage gaps → weakest subjects →
 * mock cadence → volume ramp → clamp to the bank. The clamp is why a
 * 40-question exam never gets told to answer 120: targets are honest
 * against available content, with repeats allowed only via the ×2 headroom.
 */
export function generateWeekGoals(input: GenerateWeekInput): PlanGoalsDoc {
  const targets = PLAN_INTENSITY_TARGETS[input.intensity];
  const mult = rampMultiplier(input.weeksToExam);
  const bank = input.subjects.reduce((sum, s) => sum + s.questionCount, 0);
  const goals: PlanGoal[] = [];

  // Repeating questions is legitimate practice, but a target far beyond the
  // bank is noise — cap at twice the published pool.
  const clampTotal = (n: number): number =>
    Math.max(1, Math.min(n, Math.max(1, bank * 2)));

  const mockQuestions = Math.max(
    FOCUS_MIN_QUESTIONS,
    Math.min(MOCK_QUESTIONS[input.intensity], Math.max(1, bank))
  );
  // A minute per question — the same fallback the assignment launch uses.
  const mockGoal = (diagnostic: boolean): PlanGoal => ({
    id: "mock",
    type: "mock",
    diagnostic,
    numQuestions: mockQuestions,
    durationMin: mockQuestions,
  });

  // ── Cold start: no data to rank subjects with — the diagnostic IS the plan.
  if (shouldPrescribeDiagnostic(input.allTimeAttempts, input.diagnosticDismissed)) {
    goals.push(mockGoal(true));
    goals.push({
      id: "total",
      type: "total_questions",
      target: clampTotal(Math.round(targets.questions / 2)),
    });
    return { v: 1, goals };
  }

  goals.push({
    id: "total",
    type: "total_questions",
    target: clampTotal(Math.round(targets.questions * mult)),
  });

  // ── Focus subjects: coverage gaps first, then weakest practised subjects.
  const eligible = input.subjects.filter(
    (s) => s.questionCount >= FOCUS_MIN_QUESTIONS
  );
  const byNameThenId = (a: PlanSubjectStat, b: PlanSubjectStat) =>
    a.subjectName.localeCompare(b.subjectName) ||
    a.subjectId.localeCompare(b.subjectId);
  const gaps = eligible
    .filter((s) => s.attempts < COVERAGE_GAP_ATTEMPTS)
    .sort(byNameThenId);
  const weak = eligible
    .filter((s) => s.attempts >= COVERAGE_GAP_ATTEMPTS)
    .sort(
      (a, b) =>
        (a.accuracyPct ?? 0) - (b.accuracyPct ?? 0) || byNameThenId(a, b)
    );

  const slots = targets.focusSubjects + (mult > 1 ? 1 : 0);
  const picked: { stat: PlanSubjectStat; reason: "coverage_gap" | "weak_subject" }[] =
    [];
  for (const s of gaps) {
    if (picked.length >= slots) break;
    picked.push({ stat: s, reason: "coverage_gap" });
  }
  for (const s of weak) {
    if (picked.length >= slots) break;
    picked.push({ stat: s, reason: "weak_subject" });
  }
  for (const { stat, reason } of picked) {
    goals.push({
      id: focusGoalId(stat.subjectId),
      type: "focus_sessions",
      subjectId: stat.subjectId,
      subjectName: stat.subjectName,
      reason,
      sessions: 1,
      questionsPerSession: Math.max(
        FOCUS_MIN_QUESTIONS,
        Math.min(SESSION_QUESTIONS, stat.questionCount)
      ),
    });
  }

  // ── Mock cadence: intensity's rhythm, held to biweekly in the early weeks.
  // A student who DISMISSED the cold-start diagnostic explicitly opted out
  // of timed pressure — prescribing a regular mock in the same breath would
  // read as the dismissal silently failing, so no mock until they clear the
  // diagnostic threshold on their own.
  const coldDismissed =
    input.diagnosticDismissed &&
    input.allTimeAttempts < DIAGNOSTIC_MIN_ATTEMPTS;
  const everyWeeks =
    input.priorWeekCount < EARLY_WEEKS
      ? Math.max(targets.mockEveryWeeks, 2)
      : targets.mockEveryWeeks;
  if (
    !coldDismissed &&
    mockDue(input.lastMockGoalWeekStart, input.weekStart, everyWeeks)
  ) {
    goals.push(mockGoal(false));
  }

  return { v: 1, goals };
}

/** The one user-facing name per goal — shared by /plan and the dashboard
 * card so 'Next up' always matches the goal the student clicks through to. */
export function goalTitle(goal: PlanGoal): string {
  switch (goal.type) {
    case "total_questions":
      return `Answer ${goal.target} questions`;
    case "focus_sessions":
      return `Focus session — ${goal.subjectName}`;
    case "mock":
      return goal.diagnostic ? "Diagnostic mock exam" : "Timed mock exam";
  }
}

export type WeekActivity = {
  /** All attempts for the exam in the week, both modes (weekly view). */
  attemptsInWeek: number;
  /** One row per (test, subject) with ≥1 attempt in the week. */
  sessions: {
    subjectId: string;
    testId: string;
    mode: TestMode;
    attempts: number;
  }[];
  /** Submitted exam-mode tests for the exam in the week. */
  mocks: { totalQuestions: number }[];
};

export const emptyWeekActivity = (): WeekActivity => ({
  attemptsInWeek: 0,
  sessions: [],
  mocks: [],
});

export type ActivityRows = {
  weekly: { weekStart: string; attempts: number }[];
  sessions: {
    weekStart: string;
    subjectId: string;
    testId: string;
    mode: TestMode;
    attempts: number;
  }[];
  /** Submitted exam-mode tests; bucketed into weeks HERE via the mock's
   * submitted_at, so the week rule is stated exactly once. */
  mocks: { submittedAt: string | null; totalQuestions: number }[];
};

/**
 * Fold raw activity rows into per-week WeekActivity — the ONE attribution
 * fold, shared by the student surfaces and org adherence so the two can
 * never disagree about what a week contained. `bucketMock` maps a mock's
 * submitted_at to its week Monday (mondayOf∘guyanaDay, injected so this
 * module stays free of Intl plumbing in tests).
 */
export function buildWeekActivities(
  rows: ActivityRows,
  fromWeekStart: string,
  bucketMock: (submittedAt: string) => string
): Map<string, WeekActivity> {
  const byWeek = new Map<string, WeekActivity>();
  const week = (weekStart: string): WeekActivity => {
    const existing = byWeek.get(weekStart);
    if (existing) return existing;
    const fresh = emptyWeekActivity();
    byWeek.set(weekStart, fresh);
    return fresh;
  };

  for (const r of rows.weekly) week(r.weekStart).attemptsInWeek += r.attempts;
  for (const r of rows.sessions) {
    week(r.weekStart).sessions.push({
      subjectId: r.subjectId,
      testId: r.testId,
      mode: r.mode,
      attempts: r.attempts,
    });
  }
  for (const r of rows.mocks) {
    if (r.submittedAt === null) continue;
    const bucket = bucketMock(r.submittedAt);
    if (bucket < fromWeekStart) continue;
    week(bucket).mocks.push({ totalQuestions: r.totalQuestions });
  }
  return byWeek;
}

export type GoalProgress = {
  goalId: string;
  done: number;
  target: number;
  met: boolean;
};

export type WeekProgress = {
  goals: GoalProgress[];
  metCount: number;
  total: number;
};

/**
 * Progress against a frozen doc — attribution is activity-based (decision:
 * any matching work counts, however it was launched): assignments and
 * self-built tests tick goals exactly like plan-launched sessions.
 */
export function evaluateWeekProgress(
  doc: PlanGoalsDoc,
  activity: WeekActivity
): WeekProgress {
  const goals = doc.goals.map((g): GoalProgress => {
    if (g.type === "total_questions") {
      return {
        goalId: g.id,
        done: activity.attemptsInWeek,
        target: g.target,
        met: activity.attemptsInWeek >= g.target,
      };
    }
    if (g.type === "focus_sessions") {
      // Thresholds bow to the goal's OWN prescribed size: attempts are
      // unique per (test, question), so a 6-question subject can never see
      // 10 attempts in one test — without the min() the goal is unmeetable
      // and poisons org-visible adherence forever.
      const minAttempts = Math.min(SESSION_MIN_ATTEMPTS, g.questionsPerSession);
      const tests = new Set(
        activity.sessions
          .filter(
            (s) =>
              s.subjectId === g.subjectId &&
              s.mode === "tutor" &&
              s.attempts >= minAttempts
          )
          .map((s) => s.testId)
      );
      return {
        goalId: g.id,
        done: tests.size,
        target: g.sessions,
        met: tests.size >= g.sessions,
      };
    }
    // Same small-bank rule: a sub-20-question exam prescribes a smaller
    // mock, and that mock must satisfy its own goal.
    const done = activity.mocks.filter(
      (m) => m.totalQuestions >= Math.min(MOCK_MIN_QUESTIONS, g.numQuestions)
    ).length;
    return { goalId: g.id, done, target: 1, met: done >= 1 };
  });

  return {
    goals,
    metCount: goals.filter((g) => g.met).length,
    total: goals.length,
  };
}

/**
 * Rolling adherence over the ADHERENCE_WEEKS Mondays strictly before the
 * current week (the in-progress week never drags the number down). Weeks
 * with no row count as 0 — but only from the member's FIRST plan week
 * onwards; before they ever had a plan there is nothing to adhere to, and
 * a member with no rows at all reads null ("—"), never a fake 0%.
 *
 * `earliestWeekStart` lets a caller that only fetched recent rows assert an
 * older first week it knows about (the org adherence probe) — a member who
 * planned months ago and stopped reads 0%, not "—".
 */
export function adherencePct(
  weeks: readonly { weekStart: string; metCount: number; total: number }[],
  currentWeekStart: string,
  earliestWeekStart?: string
): number | null {
  if (weeks.length === 0 && earliestWeekStart === undefined) return null;
  const earliest = weeks.reduce(
    (min, w) => (w.weekStart < min ? w.weekStart : min),
    earliestWeekStart ?? weeks[0].weekStart
  );
  const byWeek = new Map(weeks.map((w) => [w.weekStart, w]));

  const fractions: number[] = [];
  for (let i = 1; i <= ADHERENCE_WEEKS; i++) {
    const d = new Date(`${currentWeekStart}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const monday = d.toISOString().slice(0, 10);
    if (monday < earliest) continue;
    const row = byWeek.get(monday);
    // total 0 is the "row exists but its goals doc failed to parse" sentinel:
    // such a week leaves the denominator entirely — never a fake 0%.
    if (row && row.total === 0) continue;
    fractions.push(row ? row.metCount / row.total : 0);
  }
  if (fractions.length === 0) return null;
  return Math.round(
    (fractions.reduce((sum, f) => sum + f, 0) / fractions.length) * 100
  );
}

/** A launchable session derived from a frozen goal — the server-supplied
 * config for POST /api/tests, mirroring the assignment-prescription shape. */
export type PlanPrescription = {
  examId: string;
  subjectIds: string[];
  difficulty: "mixed";
  numQuestions: number;
  durationMin: number | undefined;
  mode: TestMode;
  /** Subject whose retry pool seeds the session; null for mocks. */
  seedSubjectId: string | null;
};

/**
 * Goal → prescription, the launch route's business rules stated once and
 * unit-tested: focus goals are untimed single-subject tutor sessions; mocks
 * (diagnostic included) are timed exam-mode papers spanning every published
 * subject of the exam; question targets are not launchable (the UI links
 * them to the wizard instead).
 */
export function prescriptionForGoal(
  goal: PlanGoal,
  examId: string,
  publishedSubjectIds: readonly string[]
): PlanPrescription | "not_launchable" | "no_questions" {
  if (goal.type === "total_questions") return "not_launchable";
  if (goal.type === "focus_sessions") {
    return {
      examId,
      subjectIds: [goal.subjectId],
      difficulty: "mixed",
      numQuestions: goal.questionsPerSession,
      durationMin: undefined,
      mode: "tutor",
      seedSubjectId: goal.subjectId,
    };
  }
  if (publishedSubjectIds.length === 0) return "no_questions";
  return {
    examId,
    subjectIds: [...publishedSubjectIds],
    difficulty: "mixed",
    numQuestions: goal.numQuestions,
    durationMin: goal.durationMin,
    mode: "exam",
    seedSubjectId: null,
  };
}

/**
 * Retry-seeded question pick for a focus session: ~RETRY_SEED_RATIO of the
 * paper from the retry pool (intersected with live candidates so retired
 * questions can't leak in), the rest fresh, then the WHOLE paper reshuffled
 * — seeds must never be positionally identifiable, or students learn "the
 * first N are ones I got wrong". `shuffle` is injected (lib/scoring must not
 * be pulled into client bundles through this module).
 */
export function pickSessionQuestions<T extends { id: string }>(
  candidates: readonly T[],
  retryPoolIds: ReadonlySet<string>,
  target: number,
  shuffle: <U>(items: U[]) => U[]
): T[] {
  const seeds = shuffle(candidates.filter((c) => retryPoolIds.has(c.id))).slice(
    0,
    retrySeedCount(target)
  );
  const seedIds = new Set(seeds.map((s) => s.id));
  const fresh = shuffle(candidates.filter((c) => !seedIds.has(c.id))).slice(
    0,
    target - seeds.length
  );
  return shuffle([...seeds, ...fresh]);
}

export type PrimaryExamCandidate = {
  examId: string;
  /** Resolved sitting date (personal ?? org); null = none. */
  sittingOn: string | null;
  /** Attempts inside the readiness window. */
  windowAttempts: number;
};

/**
 * Which exam leads the dashboard card — the getOwnReadiness tiebreaker,
 * extracted pure: soonest UPCOMING sitting, else most window practice, else
 * the first entitled exam (caller passes candidates in entitlement order).
 */
export function pickPrimaryExam(
  candidates: readonly PrimaryExamCandidate[],
  today: string
): string | null {
  if (candidates.length === 0) return null;
  const upcoming = candidates
    .filter((c) => c.sittingOn !== null && c.sittingOn >= today)
    .sort((a, b) => a.sittingOn!.localeCompare(b.sittingOn!));
  if (upcoming.length > 0) return upcoming[0].examId;

  const practised = [...candidates].sort(
    (a, b) => b.windowAttempts - a.windowAttempts
  );
  if (practised[0].windowAttempts > 0) return practised[0].examId;

  return candidates[0].examId;
}
