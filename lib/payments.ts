import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { nextPaymentStatus, nextRefundedCents } from "@/lib/payments-core";
import type { RefundAmounts } from "@/lib/payments-core";
import type {
  Payment,
  PaymentGrantFailure,
  PaymentSource,
  PaymentStatus,
} from "@/lib/supabase/types";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Row primitives for the `payments` table. The orchestration — record first,
 * then grant, then attach the outcome — lives in recordCapturedPurchase in
 * lib/subscriptions.ts; this module only knows how to write rows.
 */

export type RecordedPayment = { id: string; isNew: boolean };

/**
 * Insert the money row. Idempotent on the PayPal ORDER id exactly like
 * grantPlanPurchase — whoever loses the capture-route/webhook race gets the
 * existing row back with isNew:false.
 *
 * plan_id/exam_id are deliberately NOT written here: nothing has been validated
 * at this point and an unresolved id would trip the FK and lose the row this
 * table exists to keep. recordPaymentGrant fills them in afterwards, from rows
 * that have actually been read back.
 *
 * Returns null instead of throwing on a DB failure: bookkeeping must never
 * block handing over what the buyer paid for.
 */
export async function recordCapture(
  admin: AdminClient,
  input: {
    /** From custom_id on the webhook path, so unvalidated — checked here. */
    userId: string;
    /** Org purchases only; unvalidated for the same reason. */
    orgId?: string | null;
    paypalOrderId: string;
    captureId: string | null;
    customId: string | null;
    amountCents: number | null;
    currency: string | null;
    /** PayPal's capture create_time; falls back to the column default. */
    capturedAt: string | null;
    source: PaymentSource;
  }
): Promise<RecordedPayment | null> {
  // Pre-check rather than catching 23503: an FK error would abort the very
  // insert we most need to keep.
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("id", input.userId)
    .maybeSingle();

  if (!profile) {
    console.error("payment_unknown_user", {
      paypalOrderId: input.paypalOrderId,
      userId: input.userId,
    });
  }

  // Same FK caution for the org: a vanished org must not lose the money row.
  // custom_id keeps the raw id; the grant path records unknown_org.
  let orgId: string | null = null;
  if (input.orgId) {
    const { data: org } = await admin
      .from("orgs")
      .select("id")
      .eq("id", input.orgId)
      .maybeSingle();
    if (org) orgId = input.orgId;
    else {
      console.error("payment_unknown_org", {
        paypalOrderId: input.paypalOrderId,
        orgId: input.orgId,
      });
    }
  }

  const row = {
    user_id: profile ? input.userId : null,
    org_id: orgId,
    paypal_order_id: input.paypalOrderId,
    paypal_capture_id: input.captureId,
    custom_id: input.customId,
    amount_cents: input.amountCents,
    currency: input.currency,
    source: input.source,
    grant_failure: profile ? null : ("unknown_user" as PaymentGrantFailure),
    ...(input.capturedAt ? { captured_at: input.capturedAt } : {}),
  };

  const { data, error } = await admin
    .from("payments")
    .upsert(row, { onConflict: "paypal_order_id", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error("payment_record_failed", {
      paypalOrderId: input.paypalOrderId,
      error,
    });
    return null;
  }

  if (data && data.length > 0) return { id: data[0].id, isNew: true };

  // Empty result means the conflict fired — the other path recorded it first.
  const { data: existing } = await admin
    .from("payments")
    .select("id")
    .eq("paypal_order_id", input.paypalOrderId)
    .maybeSingle();

  return existing ? { id: existing.id, isNew: false } : null;
}

export type PaymentGrantOutcome =
  | {
      kind: "granted";
      subscriptionId: string;
      planId: string;
      planName: string;
      planPriceCents: number;
      examId: string | null;
    }
  | {
      kind: "granted_org";
      orgSubscriptionId: string;
      orgId: string;
      /** Exam the org bought; null = comp all-access. */
      examId: string | null;
      planId: string;
      planName: string;
      planPriceCents: number;
    }
  | {
      kind: "failed";
      reason: PaymentGrantFailure;
      planId?: string | null;
      planName?: string | null;
      planPriceCents?: number | null;
    };

/**
 * Second half of the payment write: attach whatever the grant resolved.
 *
 * The failure branch is guarded on BOTH grant links being null so a late
 * webhook whose plan lookup fails cannot stamp grant_failure onto a row the
 * capture route already linked successfully — whichever kind of grant it was.
 */
export async function recordPaymentGrant(
  admin: AdminClient,
  paymentId: string,
  outcome: PaymentGrantOutcome
): Promise<void> {
  const stamped = { updated_at: new Date().toISOString() };
  const patch =
    outcome.kind === "granted"
      ? {
          subscription_id: outcome.subscriptionId,
          plan_id: outcome.planId,
          plan_name: outcome.planName,
          plan_price_cents: outcome.planPriceCents,
          exam_id: outcome.examId,
          grant_failure: null,
          ...stamped,
        }
      : outcome.kind === "granted_org"
        ? {
            org_subscription_id: outcome.orgSubscriptionId,
            org_id: outcome.orgId,
            exam_id: outcome.examId,
            plan_id: outcome.planId,
            plan_name: outcome.planName,
            plan_price_cents: outcome.planPriceCents,
            grant_failure: null,
            ...stamped,
          }
        : {
            grant_failure: outcome.reason,
            plan_id: outcome.planId ?? null,
            plan_name: outcome.planName ?? null,
            plan_price_cents: outcome.planPriceCents ?? null,
            ...stamped,
          };

  let query = admin.from("payments").update(patch).eq("id", paymentId);
  if (outcome.kind === "failed") {
    query = query.is("subscription_id", null).is("org_subscription_id", null);
  }

  const { error } = await query;
  if (error) {
    console.error("payment_grant_record_failed", { paymentId, outcome, error });
  }
}

/** The fields a reversal handler needs back to decide on access. */
export type PaymentForReversal = Pick<
  Payment,
  | "id"
  | "user_id"
  | "paypal_order_id"
  | "amount_cents"
  | "currency"
  | "refunded_cents"
  | "status"
>;

const REVERSAL_COLUMNS =
  "id, user_id, paypal_order_id, amount_cents, currency, refunded_cents, status";

/**
 * The payment a reversal event points at, by order id or by capture id.
 *
 * Two keys because the two events carry different resources: DENIED is a
 * Capture and has supplementary_data.related_ids.order_id, while REFUNDED is a
 * Refund and reaches the capture only through its rel="up" link. See
 * resolveRefundTargets in lib/payments-core.ts.
 */
export async function findPaymentForReversal(
  admin: AdminClient,
  targets: { orderId: string | null; captureId: string | null }
): Promise<PaymentForReversal | null> {
  if (targets.orderId) {
    const { data } = await admin
      .from("payments")
      .select(REVERSAL_COLUMNS)
      .eq("paypal_order_id", targets.orderId)
      .maybeSingle();
    if (data) return data as PaymentForReversal;
  }

  if (targets.captureId) {
    const { data } = await admin
      .from("payments")
      .select(REVERSAL_COLUMNS)
      .eq("paypal_capture_id", targets.captureId)
      .maybeSingle();
    if (data) return data as PaymentForReversal;
  }

  return null;
}

/**
 * Fold a refund into the running total. Returns the figure actually stored and
 * the resulting status, or null when nothing changed (a redelivery).
 *
 * Read-modify-write rather than SQL column arithmetic: PostgREST cannot express
 * `refunded_cents + excluded` without an RPC, and keeping the arithmetic in
 * nextRefundedCents is what makes it unit-testable. Partial refunds are issued
 * by hand from the PayPal dashboard, so two landing inside one round trip is
 * not a realistic race.
 */
export async function recordRefund(
  admin: AdminClient,
  payment: PaymentForReversal,
  amounts: RefundAmounts
): Promise<{ refundedCents: number; status: PaymentStatus } | null> {
  const refundedCents = nextRefundedCents({
    currentRefundedCents: payment.refunded_cents,
    amountCents: payment.amount_cents,
    amounts,
  });
  const status = nextPaymentStatus(
    payment.status,
    refundedCents,
    payment.amount_cents
  );

  if (refundedCents === payment.refunded_cents && status === payment.status) {
    return null;
  }

  const { error } = await admin
    .from("payments")
    .update({
      refunded_cents: refundedCents,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payment.id);

  // Throws, unlike the recording helpers above: this one runs inside a webhook
  // handler, where throwing leaves processed_at null so the sweep retries.
  if (error) throw new Error(error.message);

  return { refundedCents, status };
}

/**
 * Terminal reversal — a denied capture or a completed chargeback. The amount is
 * still recorded (accounting and access are separate decisions) but the status
 * is set outright rather than derived, and never walked back afterwards.
 */
export async function recordTerminalReversal(
  admin: AdminClient,
  payment: PaymentForReversal,
  status: Extract<PaymentStatus, "denied" | "reversed">,
  amounts: RefundAmounts
): Promise<void> {
  const refundedCents = nextRefundedCents({
    currentRefundedCents: payment.refunded_cents,
    amountCents: payment.amount_cents,
    amounts,
  });

  const { error } = await admin
    .from("payments")
    .update({
      refunded_cents: refundedCents,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payment.id);

  if (error) throw new Error(error.message);
}
