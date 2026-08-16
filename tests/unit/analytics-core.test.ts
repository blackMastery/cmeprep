import { describe, expect, it } from "vitest";
import {
  addDays,
  aggregateEngagementDay,
  aggregateGross,
  analyticsDay,
  chartTicks,
  effectiveRefundedCents,
  fillDays,
  guyanaDayBounds,
  questionQuality,
  rangeStartFor,
  refundDeltas,
  revenueCsv,
  revenueKeyOf,
  rollingActive,
  rollupTargetDays,
  subjectCoverage,
  sumByCurrency,
  EASY_PCT,
  NONE_KEY,
  QUESTION_MIN_ATTEMPTS,
  UNKNOWN_KEY,
  type AttemptForRollup,
  type PaymentForRollup,
  type TestForRollup,
} from "@/lib/analytics-core";
import { RANGE_PRESETS } from "@/lib/analytics-core";
import { ANALYTICS_RANGES } from "@/lib/validation";
import { guyanaDay } from "@/lib/orgs-core";
import type { AnalyticsQuestionStat } from "@/lib/supabase/types";

const payment = (over: Partial<PaymentForRollup> = {}): PaymentForRollup => ({
  id: "p1",
  exam_id: "exam-1",
  plan_name: "3 Months",
  org_id: null,
  source: "capture_route",
  currency: "USD",
  amount_cents: 5000,
  refunded_cents: 0,
  status: "captured",
  ...over,
});

const attempt = (over: Partial<AttemptForRollup> = {}): AttemptForRollup => ({
  user_id: "u1",
  is_correct: true,
  answered_at: "2026-08-15T12:00:00.000Z",
  mode: "exam",
  exam_id: "exam-1",
  ...over,
});

const test = (over: Partial<TestForRollup> = {}): TestForRollup => ({
  status: "submitted",
  mode: "exam",
  started_at: "2026-08-15T12:00:00.000Z",
  submitted_at: "2026-08-15T13:00:00.000Z",
  expires_at: "2026-08-15T14:00:00.000Z",
  ...over,
});

const stat = (over: Partial<AnalyticsQuestionStat> = {}): AnalyticsQuestionStat => ({
  question_id: "q1",
  exam_id: "exam-1",
  subject_id: "s1",
  attempts_count: 0,
  correct_count: 0,
  last_attempted_at: null,
  computed_at: "2026-08-16T04:30:00.000Z",
  ...over,
});

describe("range presets", () => {
  it("stays in sync with the validation copy", () => {
    expect(ANALYTICS_RANGES).toEqual(RANGE_PRESETS);
  });
});

describe("day math", () => {
  it("bounds a Guyana civil day as [04:00Z, next 04:00Z)", () => {
    expect(guyanaDayBounds("2026-08-15")).toEqual({
      fromIso: "2026-08-15T04:00:00.000Z",
      toIso: "2026-08-16T04:00:00.000Z",
    });
  });

  it("rejects a malformed day", () => {
    expect(() => guyanaDayBounds("2026-8-15")).toThrow();
  });

  it("puts an instant just before 04:00Z on the PREVIOUS Guyana day", () => {
    expect(analyticsDay(new Date("2026-08-15T03:59:00.000Z"))).toBe("2026-08-14");
    expect(analyticsDay(new Date("2026-08-15T04:00:00.000Z"))).toBe("2026-08-15");
  });

  it("agrees with the Intl-based guyanaDay from orgs-core on the edges", () => {
    for (const iso of [
      "2026-08-15T03:59:59.000Z",
      "2026-08-15T04:00:00.000Z",
      "2026-12-31T23:59:00.000Z",
      "2027-01-01T03:00:00.000Z",
    ]) {
      const at = new Date(iso);
      expect(analyticsDay(at)).toBe(guyanaDay(at));
    }
  });

  it("targets the just-closed day plus two prior, newest first", () => {
    // 04:30Z on Aug 16 = 00:30 Guyana Aug 16 — the nightly cron moment.
    expect(rollupTargetDays(new Date("2026-08-16T04:30:00.000Z"))).toEqual([
      "2026-08-15",
      "2026-08-14",
      "2026-08-13",
    ]);
  });

  it("crosses month boundaries", () => {
    expect(rollupTargetDays(new Date("2026-09-01T04:30:00.000Z"))).toEqual([
      "2026-08-31",
      "2026-08-30",
      "2026-08-29",
    ]);
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
  });

  it("maps presets to inclusive range starts", () => {
    expect(rangeStartFor("7d", "2026-08-16")).toBe("2026-08-10");
    expect(rangeStartFor("30d", "2026-08-16")).toBe("2026-07-18");
    expect(rangeStartFor("12mo", "2026-08-16")).toBe("2025-08-17");
    expect(rangeStartFor("all", "2026-08-16")).toBeNull();
  });
});

describe("revenueKeyOf", () => {
  it("uses sentinels for null exam / plan / currency", () => {
    const key = revenueKeyOf(
      payment({ exam_id: null, plan_name: null, currency: null })
    );
    expect(key.examKey).toBe(NONE_KEY);
    expect(key.planKey).toBe(UNKNOWN_KEY);
    expect(key.currency).toBe(UNKNOWN_KEY);
  });

  it("splits channel on org_id", () => {
    expect(revenueKeyOf(payment()).channel).toBe("personal");
    expect(revenueKeyOf(payment({ org_id: "org-1" })).channel).toBe("org");
  });
});

describe("aggregateGross", () => {
  it("excludes denied and includes reversed captures", () => {
    const rows = aggregateGross(
      [
        payment(),
        payment({ id: "p2", status: "denied" }),
        payment({ id: "p3", status: "reversed" }),
      ],
      "2026-08-15"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].paymentsCount).toBe(2);
    expect(rows[0].grossCents).toBe(10_000);
  });

  it("counts a null amount as a payment of 0 and flags it", () => {
    const rows = aggregateGross(
      [payment(), payment({ id: "p2", amount_cents: null })],
      "2026-08-15"
    );
    expect(rows[0].paymentsCount).toBe(2);
    expect(rows[0].grossCents).toBe(5000);
    expect(rows[0].nullAmounts).toBe(1);
  });

  it("never merges currencies or breakdown keys", () => {
    const rows = aggregateGross(
      [
        payment(),
        payment({ id: "p2", currency: "EUR" }),
        payment({ id: "p3", plan_name: "12 Months" }),
      ],
      "2026-08-15"
    );
    expect(rows).toHaveLength(3);
  });
});

describe("effectiveRefundedCents", () => {
  it("reads a reversal as the full amount", () => {
    expect(
      effectiveRefundedCents(payment({ status: "reversed", refunded_cents: 0 }))
    ).toBe(5000);
  });

  it("falls back to refunded_cents when a reversal has no amount", () => {
    expect(
      effectiveRefundedCents(
        payment({ status: "reversed", amount_cents: null, refunded_cents: 1200 })
      )
    ).toBe(1200);
  });

  it("uses the running total otherwise", () => {
    expect(
      effectiveRefundedCents(
        payment({ status: "partially_refunded", refunded_cents: 1500 })
      )
    ).toBe(1500);
  });
});

describe("refundDeltas", () => {
  it("books the full total when no mark exists", () => {
    const deltas = refundDeltas(
      [payment({ refunded_cents: 1000, status: "partially_refunded" })],
      new Map()
    );
    expect(deltas).toEqual([
      expect.objectContaining({ paymentId: "p1", deltaCents: 1000, newBookedCents: 1000 }),
    ]);
  });

  it("books only the delta past the mark", () => {
    const deltas = refundDeltas(
      [payment({ refunded_cents: 1500, status: "partially_refunded" })],
      new Map([["p1", 1000]])
    );
    expect(deltas[0].deltaCents).toBe(500);
    expect(deltas[0].newBookedCents).toBe(1500);
  });

  it("skips fully-booked payments", () => {
    expect(
      refundDeltas(
        [payment({ refunded_cents: 1500, status: "partially_refunded" })],
        new Map([["p1", 1500]])
      )
    ).toEqual([]);
  });

  it("never books a negative delta when a mark is somehow ahead", () => {
    expect(
      refundDeltas(
        [payment({ refunded_cents: 1000, status: "partially_refunded" })],
        new Map([["p1", 2000]])
      )
    ).toEqual([]);
  });
});

describe("aggregateEngagementDay", () => {
  const DAY = "2026-08-15";
  const NOW = new Date("2026-08-16T04:30:00.000Z");

  it("counts distinct active users and attempt accuracy", () => {
    const { engagement, activeUserIds } = aggregateEngagementDay(
      DAY,
      [
        attempt(),
        attempt({ is_correct: false }),
        attempt({ user_id: "u2" }),
        // Outside the day — ignored even if the query over-fetched.
        attempt({ user_id: "u3", answered_at: "2026-08-16T05:00:00.000Z" }),
      ],
      [],
      NOW
    );
    expect(engagement.dau).toBe(2);
    expect(engagement.attemptsCount).toBe(3);
    expect(engagement.correctCount).toBe(2);
    expect(activeUserIds.sort()).toEqual(["u1", "u2"]);
  });

  it("buckets exam activity with NONE_KEY for unresolvable attempts", () => {
    const { examActivity } = aggregateEngagementDay(
      DAY,
      [attempt(), attempt({ exam_id: null, is_correct: false })],
      [],
      NOW
    );
    expect(examActivity).toHaveLength(2);
    const none = examActivity.find((r) => r.examKey === NONE_KEY);
    expect(none).toMatchObject({ attempts: 1, correct: 0 });
  });

  it("splits started/submitted by mode and timestamp day", () => {
    const { engagement } = aggregateEngagementDay(
      DAY,
      [],
      [
        test(), // started + submitted in-day, exam
        test({ mode: "tutor", expires_at: null }),
        // Started the day BEFORE, submitted in-day: submit counts, start doesn't.
        test({
          started_at: "2026-08-14T12:00:00.000Z",
          submitted_at: "2026-08-15T12:30:00.000Z",
        }),
      ],
      NOW
    );
    expect(engagement.testsStartedExam).toBe(1);
    expect(engagement.testsStartedTutor).toBe(1);
    expect(engagement.testsSubmittedExam).toBe(2);
    expect(engagement.testsSubmittedTutor).toBe(1);
  });

  it("counts an in_progress exam test as ended once its deadline passes", () => {
    const expired = test({
      status: "in_progress",
      submitted_at: null,
      expires_at: "2026-08-15T14:00:00.000Z",
    });
    expect(
      aggregateEngagementDay(DAY, [], [expired], NOW).engagement.testsEndedExam
    ).toBe(1);
    // Deadline inside the day but still in the future (mid-day manual run).
    const stillRunning = test({
      status: "in_progress",
      submitted_at: null,
      expires_at: "2026-08-15T14:00:00.000Z",
    });
    expect(
      aggregateEngagementDay(
        DAY,
        [],
        [stillRunning],
        new Date("2026-08-15T13:00:00.000Z")
      ).engagement.testsEndedExam
    ).toBe(0);
  });

  it("counts abandonment on the start day and never expires tutor sessions", () => {
    const { engagement } = aggregateEngagementDay(
      DAY,
      [],
      [
        test({ status: "abandoned", submitted_at: null }),
        test({
          mode: "tutor",
          status: "in_progress",
          submitted_at: null,
          expires_at: null,
        }),
      ],
      NOW
    );
    expect(engagement.testsEndedExam).toBe(1);
    expect(engagement.testsEndedTutor).toBe(0);
  });
});

describe("rollingActive", () => {
  it("windows 7 and 30 days inclusive of the day itself", () => {
    const rows = [
      { day: "2026-08-15", user_id: "u1" },
      { day: "2026-08-09", user_id: "u2" }, // exactly 7th day back — in WAU
      { day: "2026-08-08", user_id: "u3" }, // 8th day — MAU only
      { day: "2026-07-17", user_id: "u4" }, // exactly 30th day back — in MAU
      { day: "2026-07-16", user_id: "u5" }, // outside both
      { day: "2026-08-16", user_id: "u6" }, // future — excluded
    ];
    expect(rollingActive(rows, "2026-08-15")).toEqual({ wau: 2, mau: 4 });
  });

  it("counts a user once across multiple active days", () => {
    const rows = [
      { day: "2026-08-15", user_id: "u1" },
      { day: "2026-08-14", user_id: "u1" },
      { day: "2026-08-01", user_id: "u1" },
    ];
    expect(rollingActive(rows, "2026-08-15")).toEqual({ wau: 1, mau: 1 });
  });
});

describe("questionQuality", () => {
  it("gates hard and easy lists behind the attempts threshold", () => {
    const stats = [
      stat({ question_id: "noisy", attempts_count: QUESTION_MIN_ATTEMPTS - 1, correct_count: 0 }),
      stat({ question_id: "hard", attempts_count: 40, correct_count: 8 }),
      stat({ question_id: "easy", attempts_count: 40, correct_count: 40 }),
    ];
    const q = questionQuality(stats);
    expect(q.hardest.map((s) => s.question_id)).toEqual(["hard", "easy"]);
    expect(q.suspiciouslyEasy.map((s) => s.question_id)).toEqual(["easy"]);
  });

  it("applies the easy cutoff", () => {
    const justUnder = stat({
      question_id: "q-under",
      attempts_count: 100,
      correct_count: EASY_PCT - 1,
    });
    const atCutoff = stat({
      question_id: "q-at",
      attempts_count: 100,
      correct_count: EASY_PCT,
    });
    const q = questionQuality([justUnder, atCutoff]);
    expect(q.suspiciouslyEasy.map((s) => s.question_id)).toEqual(["q-at"]);
  });

  it("lists cold questions with the uncapped total", () => {
    const stats = [
      ...Array.from({ length: 25 }, (_, i) => stat({ question_id: `cold-${i}` })),
      stat({ question_id: "warm", attempts_count: 1, correct_count: 1 }),
    ];
    const q = questionQuality(stats, { listSize: 20 });
    expect(q.cold).toHaveLength(20);
    expect(q.coldTotal).toBe(25);
  });
});

describe("subjectCoverage", () => {
  it("keeps zero-attempt subjects and ranks by demand per question", () => {
    const rows = subjectCoverage(
      [
        { subjectId: "s1", subjectName: "Cardio", questionCount: 10 },
        { subjectId: "s2", subjectName: "Neuro", questionCount: 5 },
        { subjectId: "s3", subjectName: "Renal", questionCount: 0 },
      ],
      [
        stat({ subject_id: "s1", attempts_count: 10 }),
        stat({ question_id: "q2", subject_id: "s2", attempts_count: 40 }),
      ]
    );
    expect(rows.map((r) => r.subjectId)).toEqual(["s2", "s1", "s3"]);
    expect(rows[2]).toMatchObject({ attempts: 0, attemptsPerQuestion: null });
  });
});

describe("fillDays", () => {
  it("fills gaps with the empty value and folds same-day rows", () => {
    const rows = [
      { day: "2026-08-13", v: 100 },
      { day: "2026-08-13", v: 50 },
      { day: "2026-08-15", v: 25 },
    ];
    expect(fillDays("2026-08-13", "2026-08-15", rows, (r) => r.v, 0)).toEqual([
      { day: "2026-08-13", value: 150 },
      { day: "2026-08-14", value: 0 },
      { day: "2026-08-15", value: 25 },
    ]);
  });

  it("defaults gaps to null for ratio series", () => {
    expect(fillDays("2026-08-14", "2026-08-15", [], () => 1)).toEqual([
      { day: "2026-08-14", value: null },
      { day: "2026-08-15", value: null },
    ]);
  });
});

describe("sumByCurrency", () => {
  it("totals per currency without ever blending them", () => {
    const totals = sumByCurrency(
      [
        { currency: "USD", payments_count: 2, gross_cents: 10_000, null_amounts: 0 },
        { currency: "USD", payments_count: 1, gross_cents: 5000, null_amounts: 1 },
        { currency: "EUR", payments_count: 1, gross_cents: 900, null_amounts: 0 },
      ],
      [
        { currency: "USD", refund_cents: 2000 },
        { currency: "GBP", refund_cents: 100 },
      ]
    );
    expect(totals).toEqual([
      {
        currency: "USD",
        paymentsCount: 3,
        grossCents: 15_000,
        refundCents: 2000,
        netCents: 13_000,
        nullAmounts: 1,
      },
      {
        currency: "EUR",
        paymentsCount: 1,
        grossCents: 900,
        refundCents: 0,
        netCents: 900,
        nullAmounts: 0,
      },
      {
        currency: "GBP",
        paymentsCount: 0,
        grossCents: 0,
        refundCents: 100,
        netCents: -100,
        nullAmounts: 0,
      },
    ]);
  });
});

describe("chartTicks", () => {
  it("returns [0] for an empty chart", () => {
    expect(chartTicks(0)).toEqual([0]);
    expect(chartTicks(-5)).toEqual([0]);
  });

  it("starts at 0 and covers the max with round steps", () => {
    const ticks = chartTicks(970);
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)!).toBeGreaterThanOrEqual(970);
    const step = ticks[1] - ticks[0];
    expect(ticks.every((t, i) => t === i * step)).toBe(true);
  });

  it("handles tiny maxima without a zero step", () => {
    const ticks = chartTicks(3);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks.at(-1)!).toBeGreaterThanOrEqual(3);
  });
});

describe("revenueCsv", () => {
  const row = {
    day: "2026-08-15",
    exam: "PLAB 1",
    plan: '3 Months, "Best value"',
    channel: "personal",
    source: "capture_route",
    currency: "USD",
    payments: 2,
    grossCents: 10_000,
    refundCents: 1500,
  };

  it("writes a header, escapes fields, and derives net in integer cents", () => {
    const csv = revenueCsv([row]);
    const [header, line] = csv.trimEnd().split("\n");
    expect(header).toBe(
      "day,exam,plan,channel,source,currency,payments,gross_cents,refund_cents,net_cents"
    );
    expect(line).toContain('"3 Months, ""Best value"""');
    expect(line.endsWith("10000,1500,8500")).toBe(true);
  });
});
