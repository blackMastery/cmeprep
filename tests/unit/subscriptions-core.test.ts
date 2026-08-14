import { describe, expect, it } from "vitest";
import {
  activePeriodEnd,
  centsToValue,
  computePeriodEnd,
  daysUntil,
  displayStatus,
  formatOrgPurchaseCustomId,
  formatPurchaseCustomId,
  isEffectivelyActive,
  parseAnyPurchaseCustomId,
  parsePurchaseCustomId,
  stackBase,
  type SubscriptionLike,
} from "@/lib/subscriptions-core";

const USER = "3f2a1b0c-4d5e-4f60-8a9b-0c1d2e3f4a5b";
const PLAN = "9e8d7c6b-5a49-4382-b1c0-d9e8f7a6b5c4";
// The seed exam id: non-RFC-v4 on purpose, which is why validation uses
// z.guid() rather than z.uuid().
const EXAM = "e0000000-0000-0000-0000-000000000001";

const NOW = new Date("2026-07-23T12:00:00Z");
const sub = (
  status: SubscriptionLike["status"],
  end: string
): SubscriptionLike => ({ status, current_period_end: end });

describe("computePeriodEnd", () => {
  it("adds one month", () => {
    const end = computePeriodEnd(1, new Date("2026-07-21T10:00:00Z"));
    expect(end.toISOString()).toBe("2026-08-21T10:00:00.000Z");
  });

  it("adds three months across a year boundary", () => {
    const end = computePeriodEnd(3, new Date("2026-11-15T00:00:00Z"));
    expect(end.toISOString()).toBe("2027-02-15T00:00:00.000Z");
  });

  it("overflows short months in the buyer's favor (JS semantics)", () => {
    // Jan 31 + 1 month → Mar 3 (2026 is not a leap year).
    const end = computePeriodEnd(1, new Date("2026-01-31T12:00:00Z"));
    expect(end.toISOString()).toBe("2026-03-03T12:00:00.000Z");
  });

  it("stacks from a future base date", () => {
    const base = new Date("2026-09-01T23:59:59Z");
    const end = computePeriodEnd(3, base);
    expect(end.toISOString()).toBe("2026-12-01T23:59:59.000Z");
  });
});

describe("purchase custom_id", () => {
  it("round-trips user, plan and exam ids", () => {
    const customId = formatPurchaseCustomId(USER, PLAN, EXAM);
    expect(parsePurchaseCustomId(customId)).toEqual({
      userId: USER,
      planId: PLAN,
      examId: EXAM,
    });
  });

  it("stays within PayPal's 127-char limit", () => {
    expect(formatPurchaseCustomId(USER, PLAN, EXAM)).toHaveLength(110);
    expect(
      formatPurchaseCustomId(USER, PLAN, EXAM).length
    ).toBeLessThanOrEqual(127);
  });

  it("reads a legacy two-segment id as all-access", () => {
    // Orders created before exam scoping shipped can still be approved after
    // it. They were sold under blanket terms, so examId null (= all-access)
    // is the correct read — not a reason to reject the capture.
    expect(parsePurchaseCustomId(`${USER}:${PLAN}`)).toEqual({
      userId: USER,
      planId: PLAN,
      examId: null,
    });
  });

  it("rejects malformed values", () => {
    expect(parsePurchaseCustomId(null)).toBeNull();
    expect(parsePurchaseCustomId("")).toBeNull();
    expect(parsePurchaseCustomId("not-a-uuid:also-not")).toBeNull();
    expect(parsePurchaseCustomId(USER)).toBeNull();
    expect(parsePurchaseCustomId(`${USER}:${PLAN}:not-a-uuid`)).toBeNull();
    expect(parsePurchaseCustomId(`${USER}:${PLAN}:`)).toBeNull();
    expect(parsePurchaseCustomId(`${USER}:${PLAN}:${EXAM}:extra`)).toBeNull();
  });
});

describe("org purchase custom_id", () => {
  const ORG = "a0000000-0000-0000-0000-000000000001";

  it("round-trips through the orgv1 format", () => {
    const customId = formatOrgPurchaseCustomId(USER, PLAN, ORG);
    expect(parseAnyPurchaseCustomId(customId)).toEqual({
      kind: "org",
      userId: USER,
      planId: PLAN,
      orgId: ORG,
    });
  });

  it("stays within PayPal's 127-char limit", () => {
    expect(
      formatOrgPurchaseCustomId(USER, PLAN, ORG).length
    ).toBeLessThanOrEqual(127);
  });

  it("still reads personal and legacy shapes", () => {
    expect(
      parseAnyPurchaseCustomId(formatPurchaseCustomId(USER, PLAN, EXAM))
    ).toEqual({ kind: "personal", userId: USER, planId: PLAN, examId: EXAM });
    expect(parseAnyPurchaseCustomId(`${USER}:${PLAN}`)).toEqual({
      kind: "personal",
      userId: USER,
      planId: PLAN,
      examId: null,
    });
  });

  it("never half-parses a malformed orgv1 payload as personal", () => {
    // "orgv1:" declared an intent; falling through to the personal parser
    // would grant the wrong product.
    expect(parseAnyPurchaseCustomId(`orgv1:${USER}:${PLAN}`)).toBeNull();
    expect(
      parseAnyPurchaseCustomId(`orgv1:${USER}:${PLAN}:not-a-uuid`)
    ).toBeNull();
    expect(
      parseAnyPurchaseCustomId(`orgv1:${USER}:${PLAN}:${ORG}:extra`)
    ).toBeNull();
    expect(parseAnyPurchaseCustomId("orgv1:")).toBeNull();
  });

  it("rejects junk outright", () => {
    expect(parseAnyPurchaseCustomId(null)).toBeNull();
    expect(parseAnyPurchaseCustomId("")).toBeNull();
    expect(parseAnyPurchaseCustomId("orgv2:whatever")).toBeNull();
  });
});

describe("stackBase", () => {
  it("starts at the current period end when it is still in the future", () => {
    expect(stackBase("2026-09-01T12:00:00Z", NOW).toISOString()).toBe(
      "2026-09-01T12:00:00.000Z"
    );
  });

  it("starts at now() when the previous period has lapsed", () => {
    expect(stackBase("2026-07-01T12:00:00Z", NOW)).toEqual(NOW);
  });

  it("starts at now() when there is no previous period", () => {
    expect(stackBase(null, NOW)).toEqual(NOW);
  });
});

describe("daysUntil", () => {
  it("rounds partial days up", () => {
    expect(daysUntil("2026-07-23T20:00:00Z", NOW)).toBe(1);
    expect(daysUntil("2026-07-30T11:00:00Z", NOW)).toBe(7);
  });

  it("goes non-positive once the date has passed", () => {
    expect(daysUntil("2026-07-20T12:00:00Z", NOW)).toBeLessThanOrEqual(0);
  });
});

describe("centsToValue", () => {
  it("formats whole and fractional dollars", () => {
    expect(centsToValue(14400)).toBe("144.00");
    expect(centsToValue(21600)).toBe("216.00");
    expect(centsToValue(1950)).toBe("19.50");
    expect(centsToValue(5)).toBe("0.05");
    expect(centsToValue(0)).toBe("0.00");
  });
});

describe("isEffectivelyActive", () => {
  it("counts active rows with a future period end", () => {
    expect(isEffectivelyActive(sub("active", "2026-08-23T12:00:00Z"), NOW)).toBe(
      true
    );
  });

  it("rejects stale active rows past their period end", () => {
    expect(isEffectivelyActive(sub("active", "2026-07-01T12:00:00Z"), NOW)).toBe(
      false
    );
  });

  it("rejects cancelled rows even with a future period end", () => {
    expect(
      isEffectivelyActive(sub("cancelled", "2026-08-23T12:00:00Z"), NOW)
    ).toBe(false);
  });

  it("rejects expired rows", () => {
    expect(
      isEffectivelyActive(sub("expired", "2026-06-01T12:00:00Z"), NOW)
    ).toBe(false);
  });
});

describe("displayStatus", () => {
  it("renders stale active rows as expired", () => {
    expect(displayStatus(sub("active", "2026-07-01T12:00:00Z"), NOW)).toBe(
      "expired"
    );
  });

  it("keeps genuinely active rows active", () => {
    expect(displayStatus(sub("active", "2026-08-23T12:00:00Z"), NOW)).toBe(
      "active"
    );
  });

  it("keeps cancelled rows cancelled regardless of date", () => {
    expect(displayStatus(sub("cancelled", "2026-08-23T12:00:00Z"), NOW)).toBe(
      "cancelled"
    );
    expect(displayStatus(sub("cancelled", "2026-06-01T12:00:00Z"), NOW)).toBe(
      "cancelled"
    );
  });
});

describe("activePeriodEnd", () => {
  it("returns null for no subscriptions", () => {
    expect(activePeriodEnd([], NOW)).toBeNull();
  });

  it("returns null when every row has lapsed", () => {
    expect(
      activePeriodEnd(
        [sub("active", "2026-07-01T12:00:00Z"), sub("expired", "2026-05-01T12:00:00Z")],
        NOW
      )
    ).toBeNull();
  });

  it("picks the latest end among stacked active rows", () => {
    expect(
      activePeriodEnd(
        [sub("active", "2026-08-01T12:00:00Z"), sub("active", "2026-10-01T12:00:00Z")],
        NOW
      )
    ).toBe("2026-10-01T12:00:00Z");
  });
});

// Expiry warnings moved to lib/entitlements-core.ts when they became
// per-exam — see tests/unit/entitlements-core.test.ts.
