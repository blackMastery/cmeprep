import { describe, expect, it } from "vitest";
import {
  ADHERENCE_WEEKS,
  COVERAGE_GAP_ATTEMPTS,
  DIAGNOSTIC_MIN_ATTEMPTS,
  MOCK_MIN_QUESTIONS,
  MOCK_QUESTIONS,
  PLAN_INTENSITY_TARGETS,
  SESSION_MIN_ATTEMPTS,
  SESSION_QUESTIONS,
  adherencePct,
  buildWeekActivities,
  evaluateWeekProgress,
  focusGoalId,
  generateWeekGoals,
  goalTitle,
  mockDue,
  pickPrimaryExam,
  pickSessionQuestions,
  prescriptionForGoal,
  retrySeedCount,
  shouldPrescribeDiagnostic,
  weeksToExam,
  type GenerateWeekInput,
  type PlanSubjectStat,
  type WeekActivity,
} from "@/lib/plan-core";
import { planGoalsDocSchema } from "@/lib/validation";

const WEEK = "2026-08-10"; // a Monday

const subject = (
  id: string,
  over: Partial<PlanSubjectStat> = {}
): PlanSubjectStat => ({
  subjectId: `00000000-0000-4000-8000-00000000000${id}`,
  subjectName: `Subject ${id}`,
  questionCount: 100,
  attempts: 20,
  accuracyPct: 70,
  ...over,
});

const baseInput = (over: Partial<GenerateWeekInput> = {}): GenerateWeekInput => ({
  weekStart: WEEK,
  intensity: "standard",
  weeksToExam: null,
  subjects: [
    subject("1", { accuracyPct: 80 }),
    subject("2", { accuracyPct: 45 }),
    subject("3", { accuracyPct: 60 }),
    subject("4", { attempts: 0, accuracyPct: null }),
  ],
  allTimeAttempts: 200,
  lastMockGoalWeekStart: null,
  priorWeekCount: 5,
  diagnosticDismissed: false,
  ...over,
});

describe("generateWeekGoals", () => {
  it("is deterministic and always passes the doc schema", () => {
    const a = generateWeekGoals(baseInput());
    const b = generateWeekGoals(baseInput());
    expect(a).toEqual(b);
    expect(planGoalsDocSchema.safeParse(a).success).toBe(true);
  });

  it("prescribes a diagnostic mock and a modest target on cold start", () => {
    const doc = generateWeekGoals(baseInput({ allTimeAttempts: 0 }));
    expect(doc.goals[0]).toMatchObject({ type: "mock", diagnostic: true });
    expect(doc.goals[1]).toMatchObject({
      type: "total_questions",
      target: PLAN_INTENSITY_TARGETS.standard.questions / 2,
    });
    // No subject data worth ranking — no focus goals.
    expect(doc.goals).toHaveLength(2);
  });

  it("skips the diagnostic at exactly the attempts threshold", () => {
    expect(shouldPrescribeDiagnostic(DIAGNOSTIC_MIN_ATTEMPTS, false)).toBe(false);
    expect(shouldPrescribeDiagnostic(DIAGNOSTIC_MIN_ATTEMPTS - 1, false)).toBe(true);
    const doc = generateWeekGoals(
      baseInput({ allTimeAttempts: DIAGNOSTIC_MIN_ATTEMPTS })
    );
    expect(doc.goals.some((g) => g.type === "mock" && g.diagnostic)).toBe(false);
  });

  it("falls back to generic targets when the diagnostic was dismissed", () => {
    const doc = generateWeekGoals(
      baseInput({ allTimeAttempts: 3, diagnosticDismissed: true })
    );
    // The student opted OUT of timed pressure — no mock of any kind until
    // they clear the diagnostic threshold on their own.
    expect(doc.goals.some((g) => g.type === "mock")).toBe(false);
    expect(doc.goals[0].type).toBe("total_questions");
    // Once past the threshold, dismissal no longer suppresses mocks.
    const later = generateWeekGoals(
      baseInput({ allTimeAttempts: 50, diagnosticDismissed: true })
    );
    expect(later.goals.some((g) => g.type === "mock")).toBe(true);
  });

  it("puts coverage gaps before weak subjects in focus goals", () => {
    const doc = generateWeekGoals(baseInput());
    const focus = doc.goals.filter((g) => g.type === "focus_sessions");
    // Subject 4 (0 attempts) is the gap; then weakest practised (45%, 60%).
    expect(focus.map((g) => g.reason)).toEqual([
      "coverage_gap",
      "weak_subject",
      "weak_subject",
    ]);
    expect(focus[0].subjectName).toBe("Subject 4");
    expect(focus[1].subjectName).toBe("Subject 2");
  });

  it("drops subjects with too few published questions from focus goals", () => {
    const doc = generateWeekGoals(
      baseInput({
        subjects: [
          subject("1", { attempts: 0, accuracyPct: null, questionCount: 0 }),
          subject("2", { attempts: 0, accuracyPct: null, questionCount: 3 }),
          subject("3", { accuracyPct: 40 }),
        ],
      })
    );
    const focus = doc.goals.filter((g) => g.type === "focus_sessions");
    expect(focus.map((g) => g.subjectName)).toEqual(["Subject 3"]);
  });

  it("clamps session size and total target to the bank", () => {
    const doc = generateWeekGoals(
      baseInput({
        subjects: [
          subject("1", { questionCount: 8, accuracyPct: 40 }),
          subject("2", { questionCount: 12, accuracyPct: 45 }),
        ],
      })
    );
    const total = doc.goals.find((g) => g.type === "total_questions")!;
    // Bank is 20; target is capped at twice the pool, not the intensity's 120.
    expect(total.target).toBe(40);
    const focus = doc.goals.filter((g) => g.type === "focus_sessions");
    expect(focus[0].questionsPerSession).toBe(8);
    expect(
      focus.every((g) => g.questionsPerSession <= SESSION_QUESTIONS)
    ).toBe(true);
  });

  it("ramps volume in the final weeks before a sitting", () => {
    const steady = generateWeekGoals(baseInput({ weeksToExam: 10 }));
    const near = generateWeekGoals(baseInput({ weeksToExam: 4 }));
    const close = generateWeekGoals(baseInput({ weeksToExam: 2 }));
    const target = (d: typeof steady) =>
      d.goals.find((g) => g.type === "total_questions")!.target;
    expect(target(steady)).toBe(120);
    expect(target(near)).toBe(150);
    expect(target(close)).toBe(180);
    // Ramp adds one focus slot.
    const focusCount = (d: typeof steady) =>
      d.goals.filter((g) => g.type === "focus_sessions").length;
    expect(focusCount(near)).toBe(focusCount(steady) + 1);
  });

  it("holds mocks to biweekly during the first generated weeks", () => {
    const early = generateWeekGoals(
      baseInput({ priorWeekCount: 1, lastMockGoalWeekStart: "2026-08-03" })
    );
    expect(early.goals.some((g) => g.type === "mock")).toBe(false);
    const later = generateWeekGoals(
      baseInput({ priorWeekCount: 3, lastMockGoalWeekStart: "2026-08-03" })
    );
    expect(later.goals.some((g) => g.type === "mock")).toBe(true);
  });

  it("prescribes mocks on the intensity's cadence", () => {
    expect(mockDue(null, WEEK, 1)).toBe(true);
    expect(mockDue("2026-08-03", WEEK, 1)).toBe(true);
    expect(mockDue("2026-08-03", WEEK, 2)).toBe(false);
    expect(mockDue("2026-07-27", WEEK, 2)).toBe(true);
    const light = generateWeekGoals(
      baseInput({ intensity: "light", lastMockGoalWeekStart: "2026-08-03" })
    );
    expect(light.goals.some((g) => g.type === "mock")).toBe(false);
  });

  it("sizes the mock per intensity, clamped to the bank", () => {
    const doc = generateWeekGoals(baseInput({ intensity: "light" }));
    const mock = doc.goals.find((g) => g.type === "mock")!;
    expect(mock).toMatchObject({
      numQuestions: MOCK_QUESTIONS.light,
      durationMin: MOCK_QUESTIONS.light,
    });
    const tiny = generateWeekGoals(
      baseInput({ subjects: [subject("1", { questionCount: 12 })] })
    );
    const tinyMock = tiny.goals.find((g) => g.type === "mock")!;
    expect(tinyMock.numQuestions).toBe(12);
  });
});

describe("evaluateWeekProgress", () => {
  const doc = generateWeekGoals(baseInput());
  const focus = doc.goals.find((g) => g.type === "focus_sessions")!;

  const activity = (over: Partial<WeekActivity> = {}): WeekActivity => ({
    attemptsInWeek: 0,
    sessions: [],
    mocks: [],
    ...over,
  });

  it("counts attempts toward the total goal", () => {
    const progress = evaluateWeekProgress(doc, activity({ attemptsInWeek: 120 }));
    expect(progress.goals.find((g) => g.goalId === "total")).toMatchObject({
      done: 120,
      met: true,
    });
  });

  it("counts only tutor sessions at the attempt threshold for focus goals", () => {
    const at = (mode: "exam" | "tutor", attempts: number) =>
      evaluateWeekProgress(
        doc,
        activity({
          sessions: [
            { subjectId: focus.subjectId, testId: "t1", mode, attempts },
          ],
        })
      ).goals.find((g) => g.goalId === focus.id)!;

    expect(at("tutor", SESSION_MIN_ATTEMPTS).met).toBe(true);
    expect(at("tutor", SESSION_MIN_ATTEMPTS - 1).met).toBe(false);
    // An exam-mode test in the subject is practice, not a focus session.
    expect(at("exam", SESSION_MIN_ATTEMPTS).met).toBe(false);
  });

  it("dedupes focus sessions by test", () => {
    // The same test appearing twice (it can't in the view, but defensively)
    // and two distinct tests both counting.
    const progress = evaluateWeekProgress(
      doc,
      activity({
        sessions: [
          { subjectId: focus.subjectId, testId: "t1", mode: "tutor", attempts: 15 },
          { subjectId: focus.subjectId, testId: "t2", mode: "tutor", attempts: 12 },
        ],
      })
    );
    expect(progress.goals.find((g) => g.goalId === focus.id)!.done).toBe(2);
  });

  it("lets a small-bank focus goal be met by a full session of its own size", () => {
    // 6 published questions: the goal prescribes 6-question sessions, and
    // attempts are unique per (test, question) — 6 attempts MUST count.
    const smallDoc = generateWeekGoals(
      baseInput({ subjects: [subject("1", { questionCount: 6, accuracyPct: 40 })] })
    );
    const smallFocus = smallDoc.goals.find((g) => g.type === "focus_sessions")!;
    const progress = evaluateWeekProgress(
      smallDoc,
      activity({
        sessions: [
          {
            subjectId: smallFocus.subjectId,
            testId: "t1",
            mode: "tutor",
            attempts: 6,
          },
        ],
      })
    );
    expect(progress.goals.find((g) => g.goalId === smallFocus.id)!.met).toBe(true);
  });

  it("lets a small-bank mock goal be met by a mock of its own size", () => {
    // 12-question exam: the prescribed mock is 12 questions and must satisfy
    // its own goal despite MOCK_MIN_QUESTIONS being 20.
    const smallDoc = generateWeekGoals(
      baseInput({ subjects: [subject("1", { questionCount: 12 })] })
    );
    const progress = evaluateWeekProgress(
      smallDoc,
      activity({ mocks: [{ totalQuestions: 12 }] })
    );
    expect(progress.goals.find((g) => g.goalId === "mock")!.met).toBe(true);
  });

  it("requires the mock minimum size", () => {
    const small = evaluateWeekProgress(
      doc,
      activity({ mocks: [{ totalQuestions: MOCK_MIN_QUESTIONS - 1 }] })
    );
    expect(small.goals.find((g) => g.goalId === "mock")!.met).toBe(false);
    const ok = evaluateWeekProgress(
      doc,
      activity({ mocks: [{ totalQuestions: MOCK_MIN_QUESTIONS }] })
    );
    expect(ok.goals.find((g) => g.goalId === "mock")!.met).toBe(true);
  });

  it("summarises met counts", () => {
    const progress = evaluateWeekProgress(doc, activity({ attemptsInWeek: 999 }));
    expect(progress.total).toBe(doc.goals.length);
    expect(progress.metCount).toBe(1);
  });
});

describe("adherencePct", () => {
  const CURRENT = "2026-08-10";
  const week = (weekStart: string, met: number, total = 5) => ({
    weekStart,
    metCount: met,
    total,
  });

  it("is null with no plan history at all", () => {
    expect(adherencePct([], CURRENT)).toBe(null);
  });

  it("is null when the only row is the current in-progress week", () => {
    expect(adherencePct([week(CURRENT, 5)], CURRENT)).toBe(null);
  });

  it("averages the completed weeks and excludes the current one", () => {
    expect(
      adherencePct([week("2026-08-03", 5), week(CURRENT, 0)], CURRENT)
    ).toBe(100);
  });

  it("counts missing weeks as 0 once a plan history exists", () => {
    // First row 4 weeks back, then a 2-week lapse, then a full week.
    expect(
      adherencePct([week("2026-07-13", 5), week("2026-08-03", 5)], CURRENT)
    ).toBe(Math.round((1 + 0 + 0 + 1) / ADHERENCE_WEEKS * 100));
  });

  it("does not penalise weeks before the member's first plan", () => {
    // Only one completed week exists and it's the first ever: 1/1, not 1/4.
    expect(adherencePct([week("2026-08-03", 5)], CURRENT)).toBe(100);
  });

  it("drops unparseable weeks (total 0) from the denominator", () => {
    expect(
      adherencePct([week("2026-08-03", 0, 0), week("2026-07-27", 5)], CURRENT)
    ).toBe(100);
  });

  it("reads 0 for a lapsed member when an older first week is asserted", () => {
    // No recent rows, but the caller knows planning started months ago.
    expect(adherencePct([], CURRENT, "2026-03-02")).toBe(0);
    expect(adherencePct([week("2026-08-03", 5)], CURRENT, "2026-03-02")).toBe(25);
  });
});

describe("pickPrimaryExam", () => {
  const c = (
    examId: string,
    sittingOn: string | null,
    windowAttempts: number
  ) => ({ examId, sittingOn, windowAttempts });
  const TODAY = "2026-08-16";

  it("prefers the soonest upcoming sitting", () => {
    expect(
      pickPrimaryExam(
        [c("a", "2026-12-01", 0), c("b", "2026-10-01", 0)],
        TODAY
      )
    ).toBe("b");
  });

  it("ignores passed sittings", () => {
    expect(
      pickPrimaryExam([c("a", "2026-01-01", 0), c("b", null, 5)], TODAY)
    ).toBe("b");
  });

  it("falls back to the most practised exam, then the first entitled", () => {
    expect(
      pickPrimaryExam([c("a", null, 2), c("b", null, 9)], TODAY)
    ).toBe("b");
    expect(pickPrimaryExam([c("a", null, 0), c("b", null, 0)], TODAY)).toBe("a");
    expect(pickPrimaryExam([], TODAY)).toBe(null);
  });
});

describe("helpers", () => {
  it("weeksToExam counts whole weeks and rejects the past", () => {
    expect(weeksToExam(null, WEEK)).toBe(null);
    expect(weeksToExam("2026-08-10", WEEK)).toBe(0);
    expect(weeksToExam("2026-08-17", WEEK)).toBe(1);
    expect(weeksToExam("2026-08-24", WEEK)).toBe(2);
    expect(weeksToExam("2026-08-25", WEEK)).toBe(3);
    expect(weeksToExam("2026-08-01", WEEK)).toBe(null);
  });

  it("weeksToExam measures from TODAY, so a sitting passed mid-week is null", () => {
    // Sitting Tuesday, week generated on Friday of the same ISO week: the
    // Monday-relative diff is positive but the exam is over.
    expect(weeksToExam("2026-08-11", "2026-08-14")).toBe(null);
  });

  it("retrySeedCount rounds up the seed share", () => {
    expect(retrySeedCount(20)).toBe(6);
    expect(retrySeedCount(5)).toBe(2);
    expect(retrySeedCount(0)).toBe(0);
  });

  it("focusGoalId is stable per subject", () => {
    expect(focusGoalId("abc")).toBe("focus:abc");
  });

  it("coverage-gap threshold matches the readiness floor", () => {
    expect(COVERAGE_GAP_ATTEMPTS).toBe(5);
  });

  it("goalTitle names every goal type", () => {
    const doc = generateWeekGoals(baseInput());
    expect(doc.goals.map(goalTitle)).toContain("Answer 120 questions");
    expect(doc.goals.map(goalTitle)).toContain("Timed mock exam");
    const cold = generateWeekGoals(baseInput({ allTimeAttempts: 0 }));
    expect(goalTitle(cold.goals[0])).toBe("Diagnostic mock exam");
  });
});

describe("prescriptionForGoal", () => {
  const doc = generateWeekGoals(baseInput());
  const EXAM = "e0000000-0000-4000-8000-000000000001";

  it("maps a focus goal to a seeded single-subject tutor session", () => {
    const focus = doc.goals.find((g) => g.type === "focus_sessions")!;
    expect(prescriptionForGoal(focus, EXAM, ["s1", "s2"])).toEqual({
      examId: EXAM,
      subjectIds: [focus.subjectId],
      difficulty: "mixed",
      numQuestions: focus.questionsPerSession,
      durationMin: undefined,
      mode: "tutor",
      seedSubjectId: focus.subjectId,
    });
  });

  it("maps a mock to a timed exam over the published subjects", () => {
    const mock = doc.goals.find((g) => g.type === "mock")!;
    const p = prescriptionForGoal(mock, EXAM, ["s1", "s2"]);
    expect(p).toMatchObject({
      mode: "exam",
      subjectIds: ["s1", "s2"],
      numQuestions: mock.numQuestions,
      durationMin: mock.durationMin,
      seedSubjectId: null,
    });
  });

  it("rejects targets and empty exams", () => {
    const total = doc.goals.find((g) => g.type === "total_questions")!;
    expect(prescriptionForGoal(total, EXAM, ["s1"])).toBe("not_launchable");
    const mock = doc.goals.find((g) => g.type === "mock")!;
    expect(prescriptionForGoal(mock, EXAM, [])).toBe("no_questions");
  });
});

describe("pickSessionQuestions", () => {
  const candidates = Array.from({ length: 30 }, (_, i) => ({ id: `q${i}` }));
  const identity = <U,>(items: U[]) => items;

  it("seeds ~30% from the pool and fills to target with no duplicates", () => {
    // Pool of exactly retrySeedCount(20)=6 ids so every pool hit is a seed —
    // a larger pool can legitimately reappear in the fresh fill.
    const pool = new Set(["q0", "q1", "q2", "q3", "q4", "q5"]);
    const picked = pickSessionQuestions(candidates, pool, 20, identity);
    expect(picked).toHaveLength(20);
    expect(new Set(picked.map((p) => p.id)).size).toBe(20);
    expect(picked.filter((p) => pool.has(p.id))).toHaveLength(
      retrySeedCount(20)
    );
  });

  it("handles a small pool and ids not in the candidate set", () => {
    // "retired" is in the pool but not a live candidate — must never appear.
    const pool = new Set(["q0", "retired"]);
    const picked = pickSessionQuestions(candidates, pool, 20, identity);
    expect(picked).toHaveLength(20);
    expect(picked.some((p) => p.id === "retired")).toBe(false);
    expect(picked.filter((p) => pool.has(p.id))).toHaveLength(1);
  });

  it("applies the injected shuffle to the combined paper", () => {
    const pool = new Set(["q0", "q1", "q2"]);
    const reverse = <U,>(items: U[]) => [...items].reverse();
    const picked = pickSessionQuestions(candidates, pool, 10, reverse);
    // With a reversing "shuffle", the final pass reorders the seed+fresh
    // concatenation — seeds cannot all sit at the front.
    expect(picked.slice(0, 3).every((p) => pool.has(p.id))).toBe(false);
  });
});

describe("buildWeekActivities", () => {
  const bucket = (submittedAt: string) => submittedAt.slice(0, 10);

  it("folds weekly, session and mock rows into per-week activity", () => {
    const map = buildWeekActivities(
      {
        weekly: [
          { weekStart: "2026-08-03", attempts: 40 },
          { weekStart: "2026-08-03", attempts: 10 },
        ],
        sessions: [
          {
            weekStart: "2026-08-03",
            subjectId: "s1",
            testId: "t1",
            mode: "tutor",
            attempts: 12,
          },
        ],
        mocks: [
          { submittedAt: "2026-08-03T12:00:00Z", totalQuestions: 50 },
          { submittedAt: null, totalQuestions: 50 },
        ],
      },
      "2026-08-03",
      bucket
    );
    expect(map.get("2026-08-03")).toEqual({
      attemptsInWeek: 50,
      sessions: [{ subjectId: "s1", testId: "t1", mode: "tutor", attempts: 12 }],
      mocks: [{ totalQuestions: 50 }],
    });
  });

  it("drops mocks bucketed before the window", () => {
    const map = buildWeekActivities(
      {
        weekly: [],
        sessions: [],
        mocks: [{ submittedAt: "2026-07-27T12:00:00Z", totalQuestions: 50 }],
      },
      "2026-08-03",
      bucket
    );
    expect(map.size).toBe(0);
  });
});
