import { describe, expect, it } from "vitest";
import {
  centsToValue,
  computePeriodEnd,
  formatPurchaseCustomId,
  parsePurchaseCustomId,
} from "@/lib/subscriptions-core";

const USER = "3f2a1b0c-4d5e-4f60-8a9b-0c1d2e3f4a5b";
const PLAN = "9e8d7c6b-5a49-4382-b1c0-d9e8f7a6b5c4";

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
  it("round-trips user and plan ids", () => {
    const customId = formatPurchaseCustomId(USER, PLAN);
    expect(parsePurchaseCustomId(customId)).toEqual({
      userId: USER,
      planId: PLAN,
    });
  });

  it("stays within PayPal's 127-char limit", () => {
    expect(formatPurchaseCustomId(USER, PLAN).length).toBeLessThanOrEqual(127);
  });

  it("rejects malformed values", () => {
    expect(parsePurchaseCustomId(null)).toBeNull();
    expect(parsePurchaseCustomId("")).toBeNull();
    expect(parsePurchaseCustomId("not-a-uuid:also-not")).toBeNull();
    expect(parsePurchaseCustomId(USER)).toBeNull();
    expect(parsePurchaseCustomId(`${USER}:${PLAN}:extra`)).toBeNull();
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
