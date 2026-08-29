import { describe, expect, it } from "vitest";
import {
  canWithdraw,
  categoryRequired,
  effectiveTestStatus,
  needsElaboration,
  isReportableType,
  lastRuling,
  rankRollups,
  reportCapWindowStart,
  reportCategoriesFor,
  reportRate,
  REPORT_CATEGORIES,
  REPORT_RATE_FLOOR,
  splitPicks,
} from "@/lib/question-reports-core";

describe("isReportableType", () => {
  it("reports MCQs (including image-based) but never OSCE stations", () => {
    expect(isReportableType("mcq_single")).toBe(true);
    expect(isReportableType("mcq_multi")).toBe(true);
    expect(isReportableType("image_based")).toBe(true);
    expect(isReportableType("osce")).toBe(false);
  });
});

describe("categoryRequired", () => {
  it("is optional only mid-test", () => {
    expect(categoryRequired("in_progress")).toBe(false);
    expect(categoryRequired("submitted")).toBe(true);
    expect(categoryRequired("abandoned")).toBe(true);
    expect(categoryRequired(null)).toBe(true);
  });
});

describe("canWithdraw", () => {
  const base = {
    testStatus: "in_progress" as const,
    reportTestId: "t1",
    testId: "t1",
    category: null,
  };
  it("allows undoing a bare tap from the same in-progress test", () => {
    expect(canWithdraw(base)).toBe(true);
  });
  it("is final once the test is submitted", () => {
    expect(canWithdraw({ ...base, testStatus: "submitted" })).toBe(false);
  });
  it("cannot withdraw a report filed elsewhere", () => {
    expect(canWithdraw({ ...base, reportTestId: "t0" })).toBe(false);
    expect(canWithdraw({ ...base, reportTestId: null })).toBe(false);
  });
  it("cannot withdraw an elaborated report", () => {
    expect(canWithdraw({ ...base, category: "typo" })).toBe(false);
  });
});

describe("reportCapWindowStart", () => {
  it("is Guyana midnight (UTC-4) of the current civil day", () => {
    // 02:00 UTC on the 10th is still the 9th in Guyana.
    expect(reportCapWindowStart(new Date("2026-08-10T02:00:00Z"))).toBe(
      "2026-08-09T04:00:00.000Z"
    );
  });
});

describe("reportRate", () => {
  it("divides reporters by attempts and refuses a zero denominator", () => {
    expect(reportRate(8, 20)).toBe(0.4);
    expect(reportRate(3, 0)).toBeNull();
  });
});

describe("rankRollups", () => {
  it("ranks a fresh broken import above a long-lived question by rate", () => {
    const rows = [
      { questionId: "old", reporters: 15, attempts: 5000 },
      { questionId: "new", reporters: 8, attempts: 20 },
    ];
    expect(rankRollups(rows).map((r) => r.questionId)).toEqual(["new", "old"]);
  });

  it("ranks below the floor by reporter count, under every rated row", () => {
    const rows = [
      { questionId: "two", reporters: 2, attempts: 2 }, // 100% but floored
      { questionId: "four", reporters: 4, attempts: 4000 },
      { questionId: "rated", reporters: REPORT_RATE_FLOOR, attempts: 50000 },
    ];
    expect(rankRollups(rows).map((r) => r.questionId)).toEqual([
      "rated",
      "four",
      "two",
    ]);
  });

  it("breaks rate ties by reporters, then id, and does not mutate input", () => {
    const rows = [
      { questionId: "b", reporters: 10, attempts: 100 },
      { questionId: "a", reporters: 10, attempts: 100 },
      { questionId: "c", reporters: 20, attempts: 200 },
    ];
    const ranked = rankRollups(rows);
    expect(ranked.map((r) => r.questionId)).toEqual(["c", "a", "b"]);
    expect(rows.map((r) => r.questionId)).toEqual(["b", "a", "c"]);
  });

  it("treats a rated row with zero attempts as rate 0, not NaN", () => {
    const rows = [
      { questionId: "ghost", reporters: 6, attempts: 0 },
      { questionId: "real", reporters: 5, attempts: 100 },
    ];
    expect(rankRollups(rows).map((r) => r.questionId)).toEqual(["real", "ghost"]);
  });
});

describe("splitPicks", () => {
  const options = [
    { id: "A", label: "A", isCorrect: false },
    { id: "B", label: "B", isCorrect: false },
    { id: "C", label: "C", isCorrect: true },
  ];

  it("splits picks at the edit and computes percentages per side", () => {
    const split = splitPicks(
      options,
      [
        { optionId: "C", sinceEdit: true, picks: 79 },
        { optionId: "B", sinceEdit: true, picks: 9 },
        { optionId: "B", sinceEdit: false, picks: 853 },
        { optionId: "C", sinceEdit: false, picks: 217 },
      ],
      { sinceEdit: 84, beforeEdit: 1204 }
    );
    expect(split.since.attempts).toBe(84);
    expect(split.since.options.map((o) => [o.optionId, o.picks, o.percent])).toEqual([
      ["A", 0, 0],
      ["B", 9, 11],
      ["C", 79, 94],
    ]);
    expect(split.before.options.find((o) => o.optionId === "B")?.percent).toBe(71);
    expect(split.before.options.find((o) => o.optionId === "C")?.percent).toBe(18);
  });

  it("yields zeros, never NaN, when a side has no attempts", () => {
    const split = splitPicks(options, [], { sinceEdit: 0, beforeEdit: 0 });
    for (const o of [...split.since.options, ...split.before.options]) {
      expect(o.percent).toBe(0);
      expect(o.picks).toBe(0);
    }
  });

  it("keeps the question's option order and correctness", () => {
    const split = splitPicks(options, [], { sinceEdit: 1, beforeEdit: 1 });
    expect(split.since.options.map((o) => o.optionId)).toEqual(["A", "B", "C"]);
    expect(split.since.options[2].isCorrect).toBe(true);
  });
});

describe("lastRuling", () => {
  it("returns the most recent resolution, ignoring open rows", () => {
    const history = [
      { resolved_at: null, resolution: null },
      { resolved_at: "2026-01-01T00:00:00Z", resolution: "fixed" as const },
      { resolved_at: "2026-03-01T00:00:00Z", resolution: "no_change" as const },
      { resolved_at: "2026-02-01T00:00:00Z", resolution: "fixed" as const },
    ];
    expect(lastRuling(history)?.resolution).toBe("no_change");
  });
  it("is null with no resolutions", () => {
    expect(lastRuling([{ resolved_at: null, resolution: null }])).toBeNull();
  });
});

describe("effectiveTestStatus", () => {
  const now = new Date("2026-08-10T12:00:00Z");
  it("keeps a live paper in progress", () => {
    expect(
      effectiveTestStatus({ status: "in_progress", expires_at: "2026-08-10T13:00:00Z" }, now)
    ).toBe("in_progress");
  });
  it("treats an expired, unfinalised paper as submitted", () => {
    expect(
      effectiveTestStatus({ status: "in_progress", expires_at: "2026-08-10T11:00:00Z" }, now)
    ).toBe("submitted");
  });
  it("never expires a tutor session (no deadline)", () => {
    expect(effectiveTestStatus({ status: "in_progress", expires_at: null }, now)).toBe(
      "in_progress"
    );
  });
});

describe("needsElaboration", () => {
  it("is true only for a bare report from this test", () => {
    expect(needsElaboration({ testId: "t1", category: null }, "t1")).toBe(true);
    expect(needsElaboration({ testId: "t1", category: "typo" }, "t1")).toBe(false);
    expect(needsElaboration({ testId: "t0", category: null }, "t1")).toBe(false);
    expect(needsElaboration({ testId: null, category: null }, "t1")).toBe(false);
  });
});

describe("reportCategoriesFor", () => {
  it("offers 'Translation is wrong' only while a translation is on screen", () => {
    expect(reportCategoriesFor({ translationShown: true })).toContain("translation");
    expect(reportCategoriesFor({ translationShown: false })).not.toContain("translation");
    // Nothing else is dropped.
    expect(reportCategoriesFor({ translationShown: false })).toEqual(
      REPORT_CATEGORIES.filter((c) => c !== "translation")
    );
  });
});
