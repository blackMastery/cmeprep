import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhookSignature } from "@/lib/paypal";
import { dispatchPaypalEvent, type WebhookEvent } from "@/lib/paypal-events";

/** Postgres unique violation — this event was already recorded. */
const UNIQUE_VIOLATION = "23505";

/**
 * POST /api/paypal/webhook — reconciliation only. The capture route grants
 * access on the happy path; this covers browsers that died after approval,
 * plus refunds/denials/chargebacks. Unauthenticated by design: PayPal's
 * signature verification IS the auth, and `payment_events.paypal_event_id`
 * unique makes redelivery a no-op.
 *
 * The handlers live in lib/paypal-events.ts so the reconciliation sweep
 * (lib/reconcile.ts) can replay the very same code rather than a copy.
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
    await dispatchPaypalEvent(admin, event);
  } catch (error) {
    // The event row stays without processed_at so the reconciliation sweep
    // finds it; PayPal must not retry (we already stored it, so a retry would
    // hit the duplicate branch and do nothing), so still answer 200.
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
