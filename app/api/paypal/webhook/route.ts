import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import {
  capturePaypalOrder,
  verifyWebhookSignature,
  type PaypalOrder,
} from "@/lib/paypal";
import {
  grantPlanPurchase,
  syncRoleFromSubscriptions,
} from "@/lib/subscriptions";
import { parsePurchaseCustomId } from "@/lib/subscriptions-core";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Postgres unique violation — this event was already recorded. */
const UNIQUE_VIOLATION = "23505";

type WebhookEvent = {
  id: string;
  event_type: string;
  resource?: {
    id?: string;
    custom_id?: string;
    status?: string;
    purchase_units?: PaypalOrder["purchase_units"];
    supplementary_data?: { related_ids?: { order_id?: string } };
  };
};

/**
 * POST /api/paypal/webhook — reconciliation only. The capture route grants
 * access on the happy path; this covers browsers that died after approval,
 * plus refunds/denials. Unauthenticated by design: PayPal's signature
 * verification IS the auth, and `payment_events.paypal_event_id` unique
 * makes redelivery a no-op.
 */
export async function POST(request: Request) {
  // Not configured (local dev without a public URL): tell PayPal to retry
  // later rather than pretending the event was handled.
  if (!process.env.PAYPAL_WEBHOOK_ID) {
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const rawBody = await request.text();

  const verified = await verifyWebhookSignature({
    headers: request.headers,
    rawBody,
  });
  if (!verified) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  if (!event?.id || !event.event_type) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Idempotency gate: first delivery inserts, redeliveries bail here.
  const { error: insertError } = await admin.from("payment_events").insert({
    paypal_event_id: event.id,
    type: event.event_type,
    payload: JSON.parse(rawBody),
  });
  if (insertError) {
    if (insertError.code === UNIQUE_VIOLATION) {
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error("payment_event_insert_failed", { event: event.id, insertError });
    return NextResponse.json({ error: "storage_failed" }, { status: 500 });
  }

  try {
    switch (event.event_type) {
      case "PAYMENT.CAPTURE.COMPLETED":
        await handleCaptureCompleted(admin, event);
        break;
      case "PAYMENT.CAPTURE.REFUNDED":
      case "PAYMENT.CAPTURE.DENIED":
        await handleCaptureReversed(admin, event);
        break;
      case "CHECKOUT.ORDER.APPROVED":
        await handleOrderApproved(admin, event);
        break;
      default:
        // Subscribed-but-unhandled event types are recorded and ignored.
        break;
    }
  } catch (error) {
    // The event row stays without processed_at so it is findable; PayPal
    // must not retry (we already stored it), so still answer 200.
    console.error("paypal_webhook_handler_failed", {
      event: event.id,
      type: event.event_type,
      error,
    });
    return NextResponse.json({ received: true, processed: false });
  }

  await admin
    .from("payment_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("paypal_event_id", event.id);

  return NextResponse.json({ received: true });
}

/** Capture completed — grant if the capture route never ran (browser died). */
async function handleCaptureCompleted(admin: AdminClient, event: WebhookEvent) {
  const resource = event.resource;
  const parsed = parsePurchaseCustomId(resource?.custom_id);
  const orderId = resource?.supplementary_data?.related_ids?.order_id;
  if (!parsed || !orderId) return;

  const { data: plan } = await admin
    .from("plans")
    .select("*")
    .eq("id", parsed.planId)
    .maybeSingle();
  if (!plan || plan.duration_months === null) {
    console.error("paypal_webhook_unknown_plan", { event: event.id, ...parsed });
    return;
  }

  await grantPlanPurchase(admin, {
    userId: parsed.userId,
    plan,
    paypalOrderId: orderId,
    captureId: resource?.id ?? null,
    meta: { via: "paypal_webhook" },
  });
}

/** Refund or denial — cancel the matching subscription and re-sync the role. */
async function handleCaptureReversed(admin: AdminClient, event: WebhookEvent) {
  const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
  if (!orderId) return;

  const { data: sub } = await admin
    .from("subscriptions")
    .select("id, user_id, plan, status")
    .eq("paypal_subscription_id", orderId)
    .maybeSingle();
  if (!sub || sub.status === "cancelled") return;

  const { error } = await admin
    .from("subscriptions")
    .update({ status: "cancelled" })
    .eq("id", sub.id);
  if (error) throw new Error(error.message);

  await audit(sub.user_id, "subscription.cancel", sub.user_id, {
    subscriptionId: sub.id,
    plan: sub.plan,
    paypalOrderId: orderId,
    via: "paypal_webhook",
    eventType: event.event_type,
  });
  await syncRoleFromSubscriptions(admin, sub.user_id, sub.user_id);
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

  const { data: plan } = await admin
    .from("plans")
    .select("*")
    .eq("id", parsed.planId)
    .maybeSingle();
  if (!plan || plan.duration_months === null) return;

  const capture =
    captured.order.purchase_units?.[0]?.payments?.captures?.[0] ?? null;

  await grantPlanPurchase(admin, {
    userId: parsed.userId,
    plan,
    paypalOrderId: orderId,
    captureId: capture?.id ?? null,
    meta: { via: "paypal_webhook_approved" },
  });
}
