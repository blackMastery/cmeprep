import { describe, expect, it } from "vitest";
import {
  calculateStreak,
  correctOptionsInTest,
  isSelectionCorrect,
  scoreTest,
  shuffle,
} from "@/lib/scoring";

describe("correctOptionsInTest", () => {
  it("keeps correct options that the test froze", () => {
    expect(correctOptionsInTest(["a"], ["a", "b", "c"])).toEqual(["a"]);
  });

  it("drops a correct option added after the test was built", () => {
    // Admin added 'd' and marked it correct while the test was in flight.
    // The student never saw it, so it must not affect their score.
    expect(correctOptionsInTest(["a", "d"], ["a", "b", "c"])).toEqual(["a"]);
  });

  it("drops a retired correct option, which keeps is_correct = true", () => {
    expect(correctOptionsInTest(["a", "x"], ["a", "b"])).toEqual(["a"]);
  });

  it("returns empty when no correct option was on the paper", () => {
    expect(correctOptionsInTest(["z"], ["a", "b"])).toEqual([]);
  });

  it("handles an empty frozen set", () => {
    expect(correctOptionsInTest(["a"], [])).toEqual([]);
  });

  it("preserves multi-answer sets intact when all were frozen", () => {
    expect(correctOptionsInTest(["a", "c"], ["a", "b", "c"])).toEqual(["a", "c"]);
  });
});

describe("isSelectionCorrect", () => {
  it("accepts a matching single answer", () => {
    expect(isSelectionCorrect(["a"], ["a"])).toBe(true);
  });

  it("rejects a wrong single answer", () => {
    expect(isSelectionCorrect(["b"], ["a"])).toBe(false);
  });

  it("treats an empty selection as incorrect", () => {
    expect(isSelectionCorrect([], ["a"])).toBe(false);
  });

  it("accepts a multi-answer set regardless of order", () => {
    expect(isSelectionCorrect(["c", "a", "b"], ["a", "b", "c"])).toBe(true);
  });

  it("rejects a partially correct multi-answer set (all-or-nothing)", () => {
    expect(isSelectionCorrect(["a", "b"], ["a", "b", "c"])).toBe(false);
  });

  it("rejects a superset selection", () => {
    expect(isSelectionCorrect(["a", "b", "c"], ["a", "b"])).toBe(false);
  });

  it("ignores duplicate selections", () => {
    expect(isSelectionCorrect(["a", "a"], ["a"])).toBe(true);
  });
});

describe("scoreTest", () => {
  const questions = [
    { questionId: "q1", correctOptionIds: ["a"] },
    { questionId: "q2", correctOptionIds: ["a", "b"] },
    { questionId: "q3", correctOptionIds: ["c"] },
    { questionId: "q4", correctOptionIds: ["d"] },
  ];

  it("scores a mixed test correctly", () => {
    const answers = new Map<string, string[]>([
      ["q1", ["a"]], // correct
      ["q2", ["a"]], // partial -> incorrect
      ["q3", ["b"]], // wrong
      // q4 unanswered
    ]);

    const result = scoreTest(questions, answers);

    expect(result.total).toBe(4);
    expect(result.correct).toBe(1);
    expect(result.answered).toBe(3);
    expect(result.unanswered).toBe(1);
    expect(result.percentage).toBe(25);
  });

  it("marks unanswered questions as incorrect but not answered", () => {
    const result = scoreTest(questions, new Map());
    expect(result.correct).toBe(0);
    expect(result.answered).toBe(0);
    expect(result.unanswered).toBe(4);
    expect(result.percentage).toBe(0);
    expect(result.questions.every((q) => !q.isCorrect && !q.answered)).toBe(true);
  });

  it("awards 100% for a perfect test", () => {
    const answers = new Map<string, string[]>([
      ["q1", ["a"]],
      ["q2", ["b", "a"]],
      ["q3", ["c"]],
      ["q4", ["d"]],
    ]);
    expect(scoreTest(questions, answers).percentage).toBe(100);
  });

  it("rounds percentage to one decimal", () => {
    // 2 of 3 correct = 66.666… -> 66.7
    const three = [
      { questionId: "q1", correctOptionIds: ["a"] },
      { questionId: "q2", correctOptionIds: ["a"] },
      { questionId: "q3", correctOptionIds: ["a"] },
    ];
    const answers = new Map<string, string[]>([
      ["q1", ["a"]],
      ["q2", ["a"]],
      ["q3", ["z"]],
    ]);
    expect(scoreTest(three, answers).percentage).toBe(66.7);
  });

  it("handles an empty test without dividing by zero", () => {
    expect(scoreTest([], new Map()).percentage).toBe(0);
  });
});

describe("calculateStreak", () => {
  it("returns 0 with no activity", () => {
    expect(calculateStreak([], "2026-07-18")).toBe(0);
  });

  it("counts consecutive days ending today", () => {
    const days = ["2026-07-18", "2026-07-17", "2026-07-16"];
    expect(calculateStreak(days, "2026-07-18")).toBe(3);
  });

  it("keeps the streak alive when today has no activity yet", () => {
    const days = ["2026-07-17", "2026-07-16"];
    expect(calculateStreak(days, "2026-07-18")).toBe(2);
  });

  it("breaks the streak after a missed day", () => {
    const days = ["2026-07-18", "2026-07-16", "2026-07-15"];
    expect(calculateStreak(days, "2026-07-18")).toBe(1);
  });

  it("returns 0 when the last activity is older than yesterday", () => {
    expect(calculateStreak(["2026-07-10"], "2026-07-18")).toBe(0);
  });

  it("handles month boundaries", () => {
    const days = ["2026-08-01", "2026-07-31", "2026-07-30"];
    expect(calculateStreak(days, "2026-08-01")).toBe(3);
  });
});

describe("shuffle", () => {
  it("preserves every element", () => {
    const input = ["a", "b", "c", "d", "e"];
    const out = shuffle(input);
    expect(out).toHaveLength(input.length);
    expect([...out].sort()).toEqual([...input].sort());
  });

  it("does not mutate the input", () => {
    const input = ["a", "b", "c"];
    shuffle(input);
    expect(input).toEqual(["a", "b", "c"]);
  });
});
