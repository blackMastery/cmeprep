/**
 * Pure arithmetic for the payments record: parsing PayPal's decimal amounts,
 * comparing a capture against the plan it was supposed to pay for, and folding
 * refunds into a running total. No `server-only` import so vitest can exercise
 * them; the DB writes live in lib/payments.ts.
 *
 * The rule this module exists to enforce: a partial refund is RECORDED, not
 * punished. A $10 goodwill refund on a $144 annual purchase must not cost the
 * buyer a year of access.
 */

import type { PaymentStatus } from "@/lib/supabase/types";

/**
 * PayPal amount string → int cents. The inverse of centsToValue in
 * lib/subscriptions-core.ts.
 *
 * String math only — never parseFloat: `0.29 * 100` is 28.999999999999996, and
 * a cent lost per sale is a bug you find in an audit, not in a test. Returns
 * null for anything that is not a plain non-negative decimal, so the caller
 * records "no amount" instead of a guess. null, NOT 0 — 0 means "nothing was
 * refunded", which keeps access, and that is a plausible-looking wrong answer.
 *
 * A third decimal place is accepted only when it is zero: PayPal sends 3dp for
 * some currencies, and silently truncating a significant digit loses a buyer's
 * money in a currency this app does not sell in.
 */
const AMOUNT_RE = /^(\d{1,12})(?:\.(\d{1,3}))?$/;

export function valueToCents(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;

  const match = AMOUNT_RE.exec(value.trim());
  if (!match) return null;

  const [, whole, fraction = ""] = match;
  if (fraction.length === 3 && fraction[2] !== "0") return null;

  const padded = fraction.slice(0, 2).padEnd(2, "0");
  return Number(whole) * 100 + Number(padded);
}

/** A PayPal money object, as it appears on captures and refunds alike. */
export type PaypalAmount = {
  currency_code?: string;
  value?: string;
} | null | undefined;

/** Split a PayPal amount into the two columns `payments` stores. */
export function parseCaptureAmount(amount: PaypalAmount): {
  cents: number | null;
  currency: string | null;
} {
  return {
    cents: valueToCents(amount?.value),
    currency: amount?.currency_code ?? null,
  };
}

export type AmountCheck =
  | "ok"
  /** PayPal reported no usable amount — a data-quality problem, not fraud. */
  | "missing"
  | "amount_mismatch"
  | "currency_mismatch";

/**
 * Compare what PayPal moved against what the plan costs.
 *
 * Integer cents, not the old string comparison against centsToValue(): "144.0"
 * and "144.00" are the same money and must not read as a mismatch. A missing
 * currency is "missing", not a match — the old `currency_code ?? CURRENCY`
 * default silently waved through an unknown currency.
 *
 * This never blocks a grant. The money is already captured by the time anyone
 * asks; the answer goes to the logs and, permanently, to the payments row.
 */
export function checkCaptureAmount(input: {
  cents: number | null;
  currency: string | null;
  planPriceCents: number;
  expectedCurrency: string;
}): AmountCheck {
  if (input.cents === null || input.currency === null) return "missing";
  if (input.currency.toUpperCase() !== input.expectedCurrency.toUpperCase()) {
    return "currency_mismatch";
  }
  return input.cents === input.planPriceCents ? "ok" : "amount_mismatch";
}

// ── Refunds ─────────────────────────────────────────────────

/** The subset of a PAYMENT.CAPTURE.{REFUNDED,REVERSED} resource we read. */
export type RefundResource = {
  id?: string;
  amount?: PaypalAmount;
  seller_payable_breakdown?: {
    total_refunded_amount?: PaypalAmount;
  };
  links?: Array<{ rel?: string; href?: string }>;
  supplementary_data?: {
    related_ids?: { order_id?: string; capture_id?: string };
  };
} | null | undefined;

export type RefundAmounts = {
  /** Currency of THIS delivery's refund. */
  currencyCode: string | null;
  /** THIS delivery's refund amount. */
  refundCents: number | null;
  /** PayPal's cumulative total across every refund on the capture. */
  totalRefundedCents: number | null;
  /** Currency of the cumulative total, which need not match the refund's. */
  totalCurrencyCode: string | null;
};

export function readRefundAmounts(resource: RefundResource): RefundAmounts {
  const refund = parseCaptureAmount(resource?.amount);
  const total = parseCaptureAmount(
    resource?.seller_payable_breakdown?.total_refunded_amount
  );

  return {
    currencyCode: refund.currency,
    refundCents: refund.cents,
    totalRefundedCents: total.cents,
    totalCurrencyCode: total.currency,
  };
}

/**
 * Fold one refund delivery into the running total. Monotonic and clamped: the
 * result never goes down and never exceeds what was captured.
 *
 * PayPal's `seller_payable_breakdown.total_refunded_amount` is CUMULATIVE
 * across every refund on the capture, so when it is present it is used on its
 * own and our stored figure is irrelevant. That is what makes this idempotent:
 * a redelivered or replayed webhook recomputes the same total instead of adding
 * a second time. It survives a lost delivery and out-of-order arrival too.
 *
 * `currentRefundedCents + refundCents` is only a FALLBACK, for payloads with no
 * breakdown (notably a refund still in PENDING). That branch cannot be
 * idempotent without a per-refund ledger — nothing in the payload distinguishes
 * "a second $10 refund" from "the same $10 refund again". Two things bound the
 * damage: payment_events.paypal_event_id already rejects redeliveries, so the
 * only exposure is a sweep replay after a handler threw *past* the money write;
 * and the clamp below caps the total at the captured amount, so the worst case
 * is an early move to "refunded", never a nonsense figure. The real fix is a
 * payment_refunds ledger keyed on the refund id — see payments-backlog.md.
 */
export function nextRefundedCents(input: {
  currentRefundedCents: number;
  amountCents: number | null;
  amounts: RefundAmounts;
}): number {
  const { currentRefundedCents, amountCents, amounts } = input;

  const reported =
    amounts.totalRefundedCents ??
    (amounts.refundCents === null
      ? null
      : currentRefundedCents + amounts.refundCents);

  const next = Math.max(currentRefundedCents, reported ?? currentRefundedCents);
  return amountCents === null ? next : Math.min(next, amountCents);
}

/**
 * One cent, covering currency-conversion rounding and nothing else.
 *
 * Deliberately NOT wide enough to absorb PayPal's processing fee (~$4.48 on
 * $144). A merchant who refunds "everything except the fee" and a merchant who
 * issues a $140 goodwill refund on $144 are indistinguishable by amount, and
 * being wrong in the fee-tolerant direction silently revokes a year of paid
 * access — the exact failure this module exists to remove. Fee-retained refunds
 * therefore read as partial; revoke those by hand.
 */
export const FULL_REFUND_TOLERANCE_CENTS = 1;

export function isEffectivelyFullRefund(
  refundedCents: number,
  amountCents: number | null
): boolean {
  // Nothing to compare against — we cannot prove the whole thing came back.
  if (amountCents === null) return false;
  if (refundedCents <= 0) return false;
  return refundedCents >= amountCents - FULL_REFUND_TOLERANCE_CENTS;
}

export type RefundTrigger = "refund" | "denial" | "reversal";

/**
 * Should this reversal take the buyer's access away?
 *
 * The trigger is an explicit parameter rather than inferred from the amounts,
 * because ACCESS AND ACCOUNTING ARE SEPARATE DECISIONS — a reversal still
 * records its amount even though it always revokes:
 *
 *  - denial   — PAYMENT.CAPTURE.DENIED means the capture never funded. There is
 *               no amount to compare and comparing one would be a category
 *               error.
 *  - reversal — a completed chargeback is adversarial, not a customer-service
 *               gesture. The merchant has lost the money; keeping the goods on
 *               would lose those too.
 *  - refund   — amount-aware. This is the whole point.
 */
export function shouldRevokeAccess(
  trigger: RefundTrigger,
  refundedCents: number,
  amountCents: number | null
): boolean {
  if (trigger === "denial" || trigger === "reversal") return true;
  return isEffectivelyFullRefund(refundedCents, amountCents);
}

/** Never downgrades a denial or a chargeback — those are terminal. */
export function nextPaymentStatus(
  current: PaymentStatus,
  refundedCents: number,
  amountCents: number | null
): PaymentStatus {
  if (current === "denied" || current === "reversed") return current;
  if (refundedCents <= 0) return current;
  return isEffectivelyFullRefund(refundedCents, amountCents)
    ? "refunded"
    : "partially_refunded";
}

/**
 * Does this refund payload describe money in the currency we took?
 *
 * A payload carrying no currency at all is rejected: recording an amount we
 * cannot denominate is worse than recording nothing and asking a human.
 */
export function currencyMatches(
  paymentCurrency: string | null,
  amounts: RefundAmounts
): boolean {
  if (amounts.currencyCode === null) return false;

  const refundCurrency = amounts.currencyCode.toUpperCase();
  if (
    amounts.totalCurrencyCode !== null &&
    amounts.totalCurrencyCode.toUpperCase() !== refundCurrency
  ) {
    return false;
  }
  // Nothing recorded to contradict — pre-backfill rows can have no currency.
  if (paymentCurrency === null) return true;
  return paymentCurrency.toUpperCase() === refundCurrency;
}

/**
 * The capture id behind a refund, from `links[rel="up"]`.
 *
 * Matched on BOTH rel === "up" and the /captures/ path segment: rel "self"
 * points at /v2/payments/refunds/{id}, so taking the last path segment of any
 * link would silently store a refund id in paypal_capture_id.
 */
export function captureIdFromLinks(
  links: Array<{ rel?: string; href?: string }> | null | undefined
): string | null {
  if (!Array.isArray(links)) return null;

  for (const link of links) {
    if (link?.rel !== "up" || typeof link.href !== "string") continue;
    const match = /\/captures\/([^/?#]+)/.exec(link.href);
    if (match) return match[1];
  }
  return null;
}

/**
 * Which payment row a reversal event points at.
 *
 * PAYMENT.CAPTURE.DENIED carries a Capture resource, which has
 * supplementary_data. PAYMENT.CAPTURE.REFUNDED carries a REFUND resource, whose
 * documented schema has no supplementary_data at all — the capture is reached
 * through the rel="up" link. Resolution therefore has to be a chain, not one
 * field, which is why the old single-field lookup could no-op on real refunds.
 *
 * `custom_id` is deliberately not consulted: it names a user, plan and exam but
 * not an ORDER, so revoking off it could cancel the wrong exam's access.
 */
export function resolveRefundTargets(resource: RefundResource): {
  orderId: string | null;
  captureId: string | null;
} {
  const related = resource?.supplementary_data?.related_ids;
  return {
    orderId: related?.order_id ?? null,
    captureId: related?.capture_id ?? captureIdFromLinks(resource?.links),
  };
}
