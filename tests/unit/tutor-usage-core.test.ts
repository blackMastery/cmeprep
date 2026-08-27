import { describe, expect, it } from "vitest";
import {
  chartStartFor,
  compactTokens,
  costLabel,
  daySpan,
  estimateCostUsd,
  summariseUsage,
  usageByModel,
  usageByUser,
  usageDayPoints,
  MODEL_RATES,
  type UsageBucket,
  type UsageDayBucket,
  type UsageUserBucket,
} from "@/lib/tutor-usage-core";

const GPT = "openai/gpt-5.6";

const bucket = (over: Partial<UsageBucket>): UsageBucket => ({
  model: GPT,
  questions: 0,
  answers: 0,
  measured: 0,
  promptTokens: 0,
  completionTokens: 0,
  ...over,
});

describe("estimateCostUsd", () => {
  it("prices a known model per 1M tokens", () => {
    const { inputPerM, outputPerM } = MODEL_RATES[GPT];
    expect(estimateCostUsd(GPT, 1_000_000, 1_000_000)).toBeCloseTo(
      inputPerM + outputPerM
    );
    expect(estimateCostUsd(GPT, 5_000, 400)).toBeCloseTo(0.01 + 0.0048);
  });

  it("is null for the null model and for unknown models", () => {
    expect(estimateCostUsd(null, 100, 100)).toBeNull();
    expect(estimateCostUsd("openai/gpt-9", 100, 100)).toBeNull();
  });
});

describe("costLabel", () => {
  it("distinguishes unpriced, tiny and normal amounts", () => {
    expect(costLabel(null)).toBe("—");
    expect(costLabel(0)).toBe("$0.00");
    expect(costLabel(0.004)).toBe("<$0.01");
    expect(costLabel(1.234)).toBe("$1.23");
  });
});

describe("compactTokens", () => {
  it("abbreviates thousands and millions", () => {
    expect(compactTokens(950)).toBe("950");
    expect(compactTokens(1_000)).toBe("1k");
    expect(compactTokens(1_234)).toBe("1.2k");
    expect(compactTokens(2_500_000)).toBe("2.5M");
  });
});

describe("summariseUsage", () => {
  // A day: 5 questions, 4 answer rows (one call failed outright), of which
  // 3 were measured and 1 was a refusal in the null-model bucket.
  const day: UsageBucket[] = [
    bucket({ model: null, questions: 5, answers: 1 }),
    bucket({ answers: 3, measured: 3, promptTokens: 15_000, completionTokens: 1_200 }),
  ];

  it("derives failed and unmeasured from questions/answers/measured", () => {
    const t = summariseUsage(day);
    expect(t.questions).toBe(5);
    expect(t.answers).toBe(4);
    expect(t.failed).toBe(1);
    expect(t.measured).toBe(3);
    expect(t.unmeasured).toBe(1);
    expect(t.totalTokens).toBe(16_200);
  });

  it("averages over measured answers only, null when none", () => {
    expect(summariseUsage(day).avgTokensPerAnswer).toBe(5_400);
    expect(
      summariseUsage([bucket({ model: null, questions: 2, answers: 2 })])
        .avgTokensPerAnswer
    ).toBeNull();
  });

  it("never reports negative failures", () => {
    // More answers than questions can only be a range boundary artefact.
    expect(summariseUsage([bucket({ questions: 0, answers: 1, measured: 1 })]).failed).toBe(0);
  });

  it("prices per model on aggregated tokens and reports unpriced tokens", () => {
    const t = summariseUsage([
      ...day,
      bucket({ model: "openai/gpt-9", answers: 1, measured: 1, promptTokens: 700, completionTokens: 300 }),
    ]);
    expect(t.estCostUsd).toBeCloseTo(estimateCostUsd(GPT, 15_000, 1_200)!);
    expect(t.unpricedTokens).toBe(1_000);
  });

  it("has a null cost only when nothing could be priced", () => {
    const t = summariseUsage([
      bucket({ model: "openai/gpt-9", answers: 1, measured: 1, promptTokens: 10, completionTokens: 10 }),
    ]);
    expect(t.estCostUsd).toBeNull();
    expect(t.unpricedTokens).toBe(20);
    expect(summariseUsage([]).estCostUsd).toBeNull();
    expect(summariseUsage([]).unpricedTokens).toBe(0);
  });
});

describe("usageDayPoints", () => {
  it("fills empty days with zero and sums models sharing a day", () => {
    const rows: UsageDayBucket[] = [
      { day: "2026-08-20", ...bucket({ answers: 1, measured: 1, promptTokens: 100, completionTokens: 10 }) },
      { day: "2026-08-20", model: "openai/gpt-9", questions: 0, answers: 1, measured: 1, promptTokens: 50, completionTokens: 5 },
      { day: "2026-08-22", ...bucket({ answers: 1, measured: 1, promptTokens: 70, completionTokens: 7 }) },
    ];
    const { prompt, completion } = usageDayPoints(rows, "2026-08-20", "2026-08-22");
    expect(prompt).toEqual([
      { day: "2026-08-20", value: 150 },
      { day: "2026-08-21", value: 0 },
      { day: "2026-08-22", value: 70 },
    ]);
    expect(completion.map((p) => p.value)).toEqual([15, 0, 7]);
  });
});

describe("chartStartFor", () => {
  const rows: UsageDayBucket[] = [
    { day: "2026-08-10", ...bucket({}) },
    { day: "2026-08-03", ...bucket({}) },
  ];

  it("uses the preset start when there is one", () => {
    expect(chartStartFor("2026-08-01", rows, "2026-08-27")).toBe("2026-08-01");
  });

  it("starts all-time at the earliest data day, else today", () => {
    expect(chartStartFor(null, rows, "2026-08-27")).toBe("2026-08-03");
    expect(chartStartFor(null, [], "2026-08-27")).toBe("2026-08-27");
    expect(chartStartFor(null, [{ day: "2026-09-01", ...bucket({}) }], "2026-08-27")).toBe("2026-08-27");
  });
});

describe("usageByModel", () => {
  it("folds per model, heaviest first, refusals last, no empty rows", () => {
    const rows = usageByModel([
      bucket({ model: null, questions: 9, answers: 2 }),
      bucket({ answers: 2, measured: 2, promptTokens: 100, completionTokens: 10 }),
      bucket({ answers: 1, measured: 1, promptTokens: 50, completionTokens: 5 }),
      bucket({ model: "openai/gpt-9", answers: 4, measured: 4, promptTokens: 900, completionTokens: 90 }),
      bucket({ model: "openai/gpt-quiet", answers: 0 }),
    ]);
    expect(rows.map((r) => r.model)).toEqual(["openai/gpt-9", GPT, null]);
    expect(rows[1]).toMatchObject({ answers: 3, measured: 3, totalTokens: 165 });
    expect(rows[1].estCostUsd).toBeCloseTo(estimateCostUsd(GPT, 150, 15)!);
    expect(rows[0].estCostUsd).toBeNull();
    expect(rows[2]).toMatchObject({ answers: 2, measured: 0, totalTokens: 0 });
  });
});

describe("usageByUser", () => {
  const rows: UsageUserBucket[] = [
    { userId: "u1", lastAt: "2026-08-20T10:00:00Z", ...bucket({ model: null, questions: 3, answers: 1 }) },
    { userId: "u1", lastAt: "2026-08-21T10:00:00Z", ...bucket({ answers: 2, measured: 2, promptTokens: 300, completionTokens: 100 }) },
    { userId: "u2", lastAt: "2026-08-19T10:00:00Z", ...bucket({ answers: 1, measured: 1, promptTokens: 500, completionTokens: 100 }) },
  ];
  const identity = (id: string) => ({ name: `Name ${id}`, email: `${id}@x.test` });

  it("folds a student's models into one row and ranks by tokens", () => {
    const out = usageByUser(rows, 2_000, identity);
    expect(out.map((r) => r.userId)).toEqual(["u2", "u1"]);
    expect(out[1]).toMatchObject({
      name: "Name u1",
      email: "u1@x.test",
      questions: 3,
      answers: 3,
      measured: 2,
      totalTokens: 400,
      lastAt: "2026-08-21T10:00:00Z",
    });
    expect(out[1].estCostUsd).toBeCloseTo(estimateCostUsd(GPT, 300, 100)!);
  });

  it("takes share against the range total, not the listed rows", () => {
    const out = usageByUser(rows, 2_000, identity);
    expect(out[0].sharePct).toBe(30);
    expect(out[1].sharePct).toBe(20);
    expect(usageByUser(rows, 0, identity)[0].sharePct).toBe(0);
  });
});

describe("daySpan", () => {
  it("counts days inclusively", () => {
    expect(daySpan("2026-08-27", "2026-08-27")).toBe(1);
    expect(daySpan("2026-08-01", "2026-08-30")).toBe(30);
  });
});
