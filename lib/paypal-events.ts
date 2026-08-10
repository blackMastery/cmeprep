import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { capturePaypalOrder, type PaypalOrder } from "@/lib/paypal";
import {
  currencyMatches,
  parseCaptureAmount,
  readRefundAmounts,
  resolveRefundTargets,
  shouldRevokeAccess,
  type RefundTrigger,
} from "@/lib/payments-core";
import {
  findPaymentForReversal,
  recordRefund,
  recordTerminalReversal,
} from "@/lib/payments";
import {
  recordCapturedPurchase,
  syncRoleFromSubscriptions,
} from "@/lib/subscriptions";
import { parsePurchaseCustomId } from "@/lib/subscriptions-core";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * PayPal webhook event handling, extracted from the route so the reconciliation
 * sweep can re-run the SAME handlers rather than a copy of them — a second copy
 * would drift, which is the exact bug class the sweep exists to catch.
 *
 * Every handler here must be idempotent: it runs once per delivery, again on a
 * PayPal redelivery that slipped the payment_events gate, and again on every
 * sweep replay.
 */

export type WebhookEvent = {
  id: string;
  event_type: string;
  resource?: {
    id?: string;
    custom_id?: string;
    status?: string;
    create_time?: string;
    amount?: { currency_code?: string; value?: string };
    seller_payable_breakdown?: {
      total_refunded_amount?: { currency_code?: string; value?: string };
    };
    links?: Array<{ rel?: string; href?: string }>;
    purchase_units?: PaypalOrder["purchase_units"];
    supplementary_data?: {
      related_ids?: { order_id?: string; capture_id?: string };
    };
  };
};

/**
 * Run the handler for one event. Throws on failure so the caller can leave
 * `processed_at` null and let the sweep retry; returns quietly for event types
 * we subscribe to but do not act on.
 */
export async function dispatchPaypalEvent(
  admin: AdminClient,
  event: WebhookEvent
): Promise<void> {
  switch (event.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED":
      await handleCaptureCompleted(admin, event);
      break;
    case "PAYMENT.CAPTURE.REFUNDED":
      await handleCaptureRefunded(admin, event);
      break;
    case "PAYMENT.CAPTURE.DENIED":
      await handleCaptureDenied(admin, event);
      break;
    case "PAYMENT.CAPTURE.REVERSED":
      await handleCaptureReversed(admin, event);
      break;
    case "CHECKOUT.ORDER.APPROVED":
      await handleOrderApproved(admin, event);
      break;
    default:
      // Subscribed-but-unhandled event types are recorded and ignored.
      break;
  }
}

/** Capture completed — grant if the capture route never ran (browser died). */
async function handleCaptureCompleted(admin: AdminClient, event: WebhookEvent) {
  const resource = event.resource;
  const parsed = parsePurchaseCustomId(resource?.custom_id);
  const orderId = resource?.supplementary_data?.related_ids?.order_id;
  if (!parsed || !orderId) return;

  const { cents, currency } = parseCaptureAmount(resource?.amount);
  await recordCapturedPurchase(admin, {
    userId: parsed.userId,
    planId: parsed.planId,
    examId: parsed.examId,
    paypalOrderId: orderId,
    captureId: resource?.id ?? null,
    customId: resource?.custom_id ?? null,
    amountCents: cents,
    currency,
    capturedAt: resource?.create_time ?? null,
    source: "webhook_capture",
  });
}

/** Order approved but never captured — the buyer's browser died mid-flow. */
async function handleOrderApproved(admin: AdminClient, event: WebhookEvent) {
  const orderId = event.resource?.id;
  const parsed = parsePurchaseCustomId(
    event.resource?.purchase_units?.[0]?.custom_id
  );
  if (!orderId || !parsed) return;

  const captured = await capturePaypalOrder(orderId);
  // already_captured ⇒ the capture route (or a COMPLETED event) handled it.
  if (captured.kind !== "completed") return;

  const unit = captured.order.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0] ?? null;
  const { cents, currency } = parseCaptureAmount(capture?.amount);

  await recordCapturedPurchase(admin, {
    userId: parsed.userId,
    planId: parsed.planId,
    examId: parsed.examId,
    paypalOrderId: orderId,
    captureId: capture?.id ?? null,
    customId: capture?.custom_id ?? unit?.custom_id ?? null,
    amountCents: cents,
    currency,
    capturedAt: capture?.create_time ?? null,
    source: "webhook_approved",
  });
}

/**
 * A refund came back. Amount-aware: a partial refund is RECORDED and the buyer
 * keeps what they still paid for. Only a refund of effectively the whole
 * capture takes access away — a $10 goodwill refund on a $144 annual purchase
 * used to wipe the year.
 */
async function handleCaptureRefunded(admin: AdminClient, event: WebhookEvent) {
  const targets = resolveRefundTargets(event.resource);
  const payment = await findPaymentForReversal(admin, targets);

  if (!payment) {
    // Throwing leaves processed_at null, so the sweep picks this up rather than
    // the refund vanishing. Pre-payments-table captures land here too.
    console.error("paypal_refund_unresolved", {
      event: event.id,
      refundId: event.resource?.id,
      targets,
    });
    throw new Error("refund_unresolved");
  }

  const amounts = readRefundAmounts(event.resource);
  if (!currencyMatches(payment.currency, amounts)) {
    // Recording an amount we cannot denominate is worse than recording nothing.
    console.error("paypal_refund_currency_mismatch", {
      event: event.id,
      paymentId: payment.id,
      paymentCurrency: payment.currency,
      amounts,
    });
    await audit(
      payment.user_id,
      "payment.refund_currency_mismatch",
      payment.user_id,
      { paymentId: payment.id, refundId: event.resource?.id, amounts }
    );
    return;
  }

  // Money first, access second: if the revocation below throws, the sweep
  // replays and this write is a no-op while the revocation retries.
  const applied = await recordRefund(admin, payment, amounts);
  if (!applied) return; // redelivery — nothing changed

  await audit(payment.user_id, "payment.refund", payment.user_id, {
    paymentId: payment.id,
    refundId: event.resource?.id,
    refundCents: amounts.refundCents,
    refundedCentsBefore: payment.refunded_cents,
    refundedCentsAfter: applied.refundedCents,
    amountCents: payment.amount_cents,
    status: applied.status,
    via: "paypal_webhook",
    eventType: event.event_type,
  });

  if (shouldRevokeAccess("refund", applied.refundedCents, payment.amount_cents)) {
    await revokeSubscriptionForOrder(admin, payment.paypal_order_id, {
      trigger: "refund",
      eventType: event.event_type,
    });
  }
}

/**
 * The capture never funded. Always a full revocation — there is no amount to
 * compare, and comparing one would be a category error.
 */
async function handleCaptureDenied(admin: AdminClient, event: WebhookEvent) {
  await handleTerminalReversal(admin, event, "denial");
}

/**
 * A chargeback completed. Always a full revocation: the merchant has already
 * lost the money, and leaving access on loses the goods too. The amount is
 * still recorded — accounting and access are separate decisions.
 */
async function handleCaptureReversed(admin: AdminClient, event: WebhookEvent) {
  await handleTerminalReversal(admin, event, "reversal");
}

async function handleTerminalReversal(
  admin: AdminClient,
  event: WebhookEvent,
  trigger: Extract<RefundTrigger, "denial" | "reversal">
) {
  const targets = resolveRefundTargets(event.resource);
  // DENIED and REVERSED carry Capture resources, so resource.id is the capture.
  if (!targets.captureId && event.resource?.id) {
    targets.captureId = event.resource.id;
  }

  const payment = await findPaymentForReversal(admin, targets);
  const status = trigger === "denial" ? "denied" : "reversed";

  if (payment) {
    await recordTerminalReversal(
      admin,
      payment,
      status,
      readRefundAmounts(event.resource)
    );
    await audit(
      payment.user_id,
      trigger === "denial" ? "payment.denied" : "payment.reversed",
      payment.user_id,
      {
        paymentId: payment.id,
        paypalOrderId: payment.paypal_order_id,
        amountCents: payment.amount_cents,
        via: "paypal_webhook",
        eventType: event.event_type,
      }
    );
  } else {
    console.error("paypal_reversal_unresolved", {
      event: event.id,
      type: event.event_type,
      targets,
    });
  }

  // Revoke by order id even with no payment row — a capture from before the
  // payments table shipped still bought a subscription that has to go.
  const orderId = targets.orderId ?? payment?.paypal_order_id ?? null;
  if (orderId) {
    await revokeSubscriptionForOrder(admin, orderId, {
      trigger,
      eventType: event.event_type,
    });
  }
}

/**
 * Revoke the access one PayPal order bought. One order maps to exactly one
 * subscription row, so cancelling by order id revokes precisely the right
 * exam's access.
 *
 * Known limitation, deliberately not fixed here: refunding the FIRST of two
 * stacked purchases leaves the second row's current_period_end, which stackBase
 * computed from it, built on refunded money. Fixing that means recomputing a
 * chain — see payments-backlog.md.
 */
async function revokeSubscriptionForOrder(
  admin: AdminClient,
  orderId: string,
  reason: { trigger: RefundTrigger; eventType: string }
): Promise<void> {
  const { data: sub } = await admin
    .from("subscriptions")
    .select("id, user_id, plan, status, exam_id")
    .eq("paypal_subscription_id", orderId)
    .maybeSingle();
  if (!sub || sub.status === "cancelled") return;

  const { error } = await admin
    .from("subscriptions")
    // updated_at was added in 20260726000001 and this path never set it, so a
    // revocation's only timestamp was its audit row.
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", sub.id);
  if (error) throw new Error(error.message);

  await audit(sub.user_id, "subscription.cancel", sub.user_id, {
    subscriptionId: sub.id,
    plan: sub.plan,
    examId: sub.exam_id,
    paypalOrderId: orderId,
    trigger: reason.trigger,
    via: "paypal_webhook",
    eventType: reason.eventType,
  });
  await syncRoleFromSubscriptions(admin, sub.user_id, sub.user_id);
}
