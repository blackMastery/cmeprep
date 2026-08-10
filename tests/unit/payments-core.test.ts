import { describe, expect, it } from "vitest";
import { centsToValue } from "@/lib/subscriptions-core";
import {
  captureIdFromLinks,
  checkCaptureAmount,
  currencyMatches,
  isEffectivelyFullRefund,
  nextPaymentStatus,
  nextRefundedCents,
  parseCaptureAmount,
  readRefundAmounts,
  resolveRefundTargets,
  shouldRevokeAccess,
  valueToCents,
  type RefundAmounts,
  type RefundResource,
} from "@/lib/payments-core";

/** The $144 annual purchase from the bug this module was written for. */
const ANNUAL_CENTS = 14400;

const amounts = (over: Partial<RefundAmounts> = {}): RefundAmounts => ({
  currencyCode: "USD",
  refundCents: 1000,
  totalRefundedCents: 1000,
  totalCurrencyCode: "USD",
  ...over,
});

const refund = (over: Partial<NonNullable<RefundResource>> = {}) => ({
  id: "4D780477II019004G",
  amount: { currency_code: "USD", value: "10.00" },
  seller_payable_breakdown: {
    total_refunded_amount: { currency_code: "USD", value: "10.00" },
  },
  links: [
    {
      rel: "self",
      href: "https://api.paypal.com/v2/payments/refunds/4D780477II019004G",
    },
    {
      rel: "up",
      href: "https://api.paypal.com/v2/payments/captures/3C679366HH908993F",
    },
  ],
  ...over,
});

describe("valueToCents", () => {
  it("parses whole and fractional dollar amounts", () => {
    expect(valueToCents("144.00")).toBe(14400);
    expect(valueToCents("144")).toBe(14400);
    expect(valueToCents("19.50")).toBe(1950);
    expect(valueToCents("0.05")).toBe(5);
    expect(valueToCents("0.00")).toBe(0);
  });

  it("round-trips every amount centsToValue produces", () => {
    for (const cents of [0, 1, 5, 99, 100, 1950, 14400, 999_99]) {
      expect(valueToCents(centsToValue(cents))).toBe(cents);
    }
  });

  it("avoids binary float error on values like 0.29 and 19.99", () => {
    // parseFloat("0.29") * 100 is 28.999999999999996.
    expect(valueToCents("0.29")).toBe(29);
    expect(valueToCents("19.99")).toBe(1999);
    expect(valueToCents("1.10")).toBe(110);
  });

  it("accepts a single decimal place, which PayPal sometimes sends", () => {
    expect(valueToCents("144.0")).toBe(14400);
    expect(valueToCents("144.5")).toBe(14450);
  });

  it("accepts a trailing zero third decimal but rejects a significant one", () => {
    expect(valueToCents("144.000")).toBe(14400);
    expect(valueToCents("144.005")).toBeNull();
  });

  it("rejects negative, exponential, empty and non-numeric values", () => {
    for (const bad of ["-1.00", "1e2", "", "abc", "1,234.00", "$144", "144.0000"]) {
      expect(valueToCents(bad)).toBeNull();
    }
  });

  it("returns null rather than zero for null and undefined", () => {
    // 0 would mean "nothing was refunded", which keeps access — a plausible
    // wrong answer is worse than no answer.
    expect(valueToCents(null)).toBeNull();
    expect(valueToCents(undefined)).toBeNull();
  });
});

describe("parseCaptureAmount", () => {
  it("splits a PayPal money object into cents and currency", () => {
    expect(parseCaptureAmount({ currency_code: "USD", value: "144.00" })).toEqual({
      cents: 14400,
      currency: "USD",
    });
  });

  it("reports a missing value as null cents without losing the currency", () => {
    expect(parseCaptureAmount({ currency_code: "USD" })).toEqual({
      cents: null,
      currency: "USD",
    });
  });

  it("returns nulls for an absent amount", () => {
    expect(parseCaptureAmount(undefined)).toEqual({ cents: null, currency: null });
  });
});

describe("checkCaptureAmount", () => {
  const check = (over: Partial<Parameters<typeof checkCaptureAmount>[0]> = {}) =>
    checkCaptureAmount({
      cents: ANNUAL_CENTS,
      currency: "USD",
      planPriceCents: ANNUAL_CENTS,
      expectedCurrency: "USD",
      ...over,
    });

  it("passes a capture that matches the plan price exactly", () => {
    expect(check()).toBe("ok");
  });

  it("treats 144.0 and 144.00 as the same money", () => {
    // The regression the old string compare against centsToValue would flag.
    expect(check({ cents: valueToCents("144.0") })).toBe("ok");
  });

  it("flags an underpayment and an overpayment alike", () => {
    expect(check({ cents: 14399 })).toBe("amount_mismatch");
    expect(check({ cents: 14401 })).toBe("amount_mismatch");
  });

  it("flags a capture taken in another currency", () => {
    expect(check({ currency: "EUR" })).toBe("currency_mismatch");
  });

  it("does not care about the case PayPal writes the currency in", () => {
    expect(check({ currency: "usd" })).toBe("ok");
  });

  it("reports an unreadable amount as missing rather than as a mismatch", () => {
    expect(check({ cents: null })).toBe("missing");
    expect(check({ currency: null })).toBe("missing");
  });
});

describe("readRefundAmounts", () => {
  it("reads this delivery's amount and PayPal's cumulative total", () => {
    expect(
      readRefundAmounts(
        refund({
          amount: { currency_code: "USD", value: "10.00" },
          seller_payable_breakdown: {
            total_refunded_amount: { currency_code: "USD", value: "35.00" },
          },
        })
      )
    ).toEqual({
      currencyCode: "USD",
      refundCents: 1000,
      totalRefundedCents: 3500,
      totalCurrencyCode: "USD",
    });
  });

  it("returns a null cumulative total when seller_payable_breakdown is absent", () => {
    const amounts = readRefundAmounts(
      refund({ seller_payable_breakdown: undefined })
    );
    expect(amounts.refundCents).toBe(1000);
    expect(amounts.totalRefundedCents).toBeNull();
  });

  it("returns nulls for a resource that carries no amounts at all", () => {
    expect(readRefundAmounts(undefined)).toEqual({
      currencyCode: null,
      refundCents: null,
      totalRefundedCents: null,
      totalCurrencyCode: null,
    });
  });
});

describe("nextRefundedCents", () => {
  const fold = (
    currentRefundedCents: number,
    over: Partial<RefundAmounts>,
    amountCents: number | null = ANNUAL_CENTS
  ) =>
    nextRefundedCents({
      currentRefundedCents,
      amountCents,
      amounts: amounts(over),
    });

  it("trusts PayPal's cumulative total over our own running sum", () => {
    // We think 1000 and this delivery is 1000, but PayPal says 3500 has come
    // back in total — an earlier delivery went missing.
    expect(fold(1000, { refundCents: 1000, totalRefundedCents: 3500 })).toBe(3500);
  });

  it("adds this delivery's amount when PayPal sends no cumulative total", () => {
    expect(fold(1000, { refundCents: 500, totalRefundedCents: null })).toBe(1500);
  });

  it("never decreases, so a redelivered webhook cannot double-count", () => {
    const delivery = { refundCents: 1000, totalRefundedCents: 1000 };
    const first = fold(0, delivery);
    expect(first).toBe(1000);
    expect(fold(first, delivery)).toBe(1000);
  });

  it("never decreases when PayPal reports a stale lower total", () => {
    expect(fold(3500, { refundCents: null, totalRefundedCents: 1000 })).toBe(3500);
  });

  it("leaves the stored figure untouched when the payload carries no usable amount", () => {
    expect(fold(1000, { refundCents: null, totalRefundedCents: null })).toBe(1000);
  });

  it("never exceeds the captured amount, whatever PayPal reports", () => {
    // Bounds the one case that cannot be idempotent: an incremental-only
    // payload replayed after a downstream failure.
    expect(fold(14000, { refundCents: 1000, totalRefundedCents: null })).toBe(
      ANNUAL_CENTS
    );
    expect(fold(0, { refundCents: null, totalRefundedCents: 20000 })).toBe(
      ANNUAL_CENTS
    );
  });

  it("cannot clamp when the captured amount was never recorded", () => {
    expect(fold(0, { refundCents: 20000, totalRefundedCents: null }, null)).toBe(20000);
  });
});

describe("isEffectivelyFullRefund", () => {
  it("treats a refund of the exact captured amount as full", () => {
    expect(isEffectivelyFullRefund(ANNUAL_CENTS, ANNUAL_CENTS)).toBe(true);
  });

  it("treats a $10 goodwill refund on a $144 purchase as partial", () => {
    expect(isEffectivelyFullRefund(1000, ANNUAL_CENTS)).toBe(false);
  });

  it("treats a fee-retained refund as partial, not full", () => {
    // $139.52 of $144 — the merchant kept the PayPal fee. Deliberately partial:
    // it is indistinguishable by amount from a large goodwill refund.
    expect(isEffectivelyFullRefund(13952, ANNUAL_CENTS)).toBe(false);
  });

  it("absorbs a one-cent rounding shortfall", () => {
    expect(isEffectivelyFullRefund(ANNUAL_CENTS - 1, ANNUAL_CENTS)).toBe(true);
    expect(isEffectivelyFullRefund(ANNUAL_CENTS - 2, ANNUAL_CENTS)).toBe(false);
  });

  it("treats an over-refund as full", () => {
    expect(isEffectivelyFullRefund(ANNUAL_CENTS + 100, ANNUAL_CENTS)).toBe(true);
  });

  it("treats a zero refund as partial", () => {
    expect(isEffectivelyFullRefund(0, ANNUAL_CENTS)).toBe(false);
  });

  it("cannot call a refund full when the captured amount was never recorded", () => {
    expect(isEffectivelyFullRefund(ANNUAL_CENTS, null)).toBe(false);
  });
});

describe("shouldRevokeAccess", () => {
  it("leaves access intact on a partial refund", () => {
    expect(shouldRevokeAccess("refund", 1000, ANNUAL_CENTS)).toBe(false);
  });

  it("revokes on a full refund", () => {
    expect(shouldRevokeAccess("refund", ANNUAL_CENTS, ANNUAL_CENTS)).toBe(true);
  });

  it("revokes on a denial regardless of amount, because the capture never funded", () => {
    expect(shouldRevokeAccess("denial", 0, ANNUAL_CENTS)).toBe(true);
  });

  it("revokes on a denial even when no amount is recorded at all", () => {
    expect(shouldRevokeAccess("denial", 0, null)).toBe(true);
  });

  it("revokes on a chargeback reversal regardless of amount", () => {
    expect(shouldRevokeAccess("reversal", 1000, ANNUAL_CENTS)).toBe(true);
  });
});

describe("nextPaymentStatus", () => {
  it("moves a captured payment to partially_refunded on a goodwill refund", () => {
    expect(nextPaymentStatus("captured", 1000, ANNUAL_CENTS)).toBe(
      "partially_refunded"
    );
  });

  it("moves a captured payment to refunded once the whole amount is back", () => {
    expect(nextPaymentStatus("captured", ANNUAL_CENTS, ANNUAL_CENTS)).toBe("refunded");
  });

  it("promotes a partially_refunded payment once the remainder comes back", () => {
    expect(nextPaymentStatus("partially_refunded", ANNUAL_CENTS, ANNUAL_CENTS)).toBe(
      "refunded"
    );
  });

  it("leaves a captured payment alone when nothing has been refunded", () => {
    expect(nextPaymentStatus("captured", 0, ANNUAL_CENTS)).toBe("captured");
  });

  it("does not downgrade a denied payment when a later refund event arrives", () => {
    expect(nextPaymentStatus("denied", 1000, ANNUAL_CENTS)).toBe("denied");
  });

  it("does not downgrade a reversed payment on a subsequent partial refund", () => {
    expect(nextPaymentStatus("reversed", 1000, ANNUAL_CENTS)).toBe("reversed");
  });
});

describe("currencyMatches", () => {
  it("accepts a refund in the currency the payment was taken in", () => {
    expect(currencyMatches("USD", amounts())).toBe(true);
  });

  it("rejects a refund whose currency differs from the payment", () => {
    expect(
      currencyMatches("USD", amounts({ currencyCode: "EUR", totalCurrencyCode: "EUR" }))
    ).toBe(false);
  });

  it("rejects a payload that carries no currency at all", () => {
    expect(currencyMatches("USD", amounts({ currencyCode: null }))).toBe(false);
  });

  it("rejects when the cumulative total is in a different currency from the refund", () => {
    expect(currencyMatches("USD", amounts({ totalCurrencyCode: "EUR" }))).toBe(false);
  });

  it("accepts when the payment predates currency being recorded", () => {
    expect(currencyMatches(null, amounts())).toBe(true);
  });
});

describe("captureIdFromLinks", () => {
  it("reads the capture id from the rel=up link", () => {
    expect(captureIdFromLinks(refund().links)).toBe("3C679366HH908993F");
  });

  it("ignores the rel=self link, which points at the refund not the capture", () => {
    expect(
      captureIdFromLinks([
        {
          rel: "self",
          href: "https://api.paypal.com/v2/payments/refunds/4D780477II019004G",
        },
      ])
    ).toBeNull();
  });

  it("ignores a capture-shaped href that is not the rel=up link", () => {
    expect(
      captureIdFromLinks([
        {
          rel: "related",
          href: "https://api.paypal.com/v2/payments/captures/3C679366HH908993F",
        },
      ])
    ).toBeNull();
  });

  it("returns null for missing or malformed links", () => {
    expect(captureIdFromLinks(undefined)).toBeNull();
    expect(captureIdFromLinks([{ rel: "up" }])).toBeNull();
    expect(captureIdFromLinks([{ rel: "up", href: "not-a-url" }])).toBeNull();
  });
});

describe("resolveRefundTargets", () => {
  it("reads the order id from supplementary_data when PayPal sends it", () => {
    // The shape PAYMENT.CAPTURE.DENIED uses — its resource is a Capture.
    expect(
      resolveRefundTargets(
        refund({
          supplementary_data: {
            related_ids: { order_id: "5O190127TN364715T", capture_id: "3C679366HH908993F" },
          },
        })
      )
    ).toEqual({ orderId: "5O190127TN364715T", captureId: "3C679366HH908993F" });
  });

  it("falls back to the rel=up link when supplementary_data is absent", () => {
    // The shape PAYMENT.CAPTURE.REFUNDED uses — its resource is a Refund, which
    // has no supplementary_data at all. The old single-field lookup no-opped
    // here, which is why every real refund had to be resolved by hand.
    expect(resolveRefundTargets(refund())).toEqual({
      orderId: null,
      captureId: "3C679366HH908993F",
    });
  });

  it("returns nulls when neither supplementary_data nor links resolve", () => {
    expect(resolveRefundTargets({ id: "R-1" })).toEqual({
      orderId: null,
      captureId: null,
    });
  });
});
