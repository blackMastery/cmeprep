import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import {
  capturePaypalOrder,
  getPaypalOrder,
  CURRENCY,
  type PaypalOrder,
} from "@/lib/paypal";
import { grantPlanPurchase } from "@/lib/subscriptions";
import {
  centsToValue,
  parsePurchaseCustomId,
} from "@/lib/subscriptions-core";

/** PayPal order ids are short alphanumeric tokens, not uuids. */
const ORDER_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * POST /api/paypal/orders/[orderId]/capture — capture the payment and grant
 * the subscription. The webhook route covers the browser-died case; this is
 * the happy path, so access is granted before any webhook arrives.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/paypal/orders/[orderId]/capture">
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (user.profile.banned_at) {
    return NextResponse.json({ error: "Account suspended" }, { status: 403 });
  }

  const { orderId } = await ctx.params;
  if (!ORDER_ID_RE.test(orderId)) {
    return NextResponse.json({ error: "Invalid order" }, { status: 400 });
  }

  let order: PaypalOrder;
  const captured = await capturePaypalOrder(orderId);
  if (captured.kind === "completed") {
    order = captured.order;
  } else if (captured.kind === "already_captured") {
    // Double-click / retry: confirm at PayPal and fall through to the grant,
    // which is idempotent on the order id.
    const existing = await getPaypalOrder(orderId);
    if (!existing || existing.status !== "COMPLETED") {
      return NextResponse.json({ error: "capture_conflict" }, { status: 409 });
    }
    order = existing;
  } else {
    // Nothing was charged — the buttons stay usable for a retry.
    return NextResponse.json({ error: "capture_failed" }, { status: 502 });
  }

  const unit = order.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const parsed = parsePurchaseCustomId(capture?.custom_id ?? unit?.custom_id);
  if (!capture || !parsed) {
    console.error("paypal_capture_missing_custom_id", { orderId });
    return NextResponse.json({ error: "capture_failed" }, { status: 502 });
  }

  // The custom_id was set server-side at order creation — it, not the
  // session, names the buyer. Capturing someone else's order is a 403.
  if (parsed.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("plans")
    .select("*")
    .eq("id", parsed.planId)
    .maybeSingle();

  if (!plan || plan.duration_months === null) {
    // Money was captured but the plan vanished — surface loudly for support.
    console.error("paypal_captured_unknown_plan", { orderId, ...parsed });
    return NextResponse.json({ error: "plan_unavailable" }, { status: 500 });
  }

  // The money is already captured, so a mismatch never blocks the grant —
  // it gets flagged in the audit trail instead.
  const amountMismatch =
    capture.amount?.value !== centsToValue(plan.price_cents) ||
    (capture.amount?.currency_code ?? CURRENCY) !== CURRENCY;
  if (amountMismatch) {
    console.error("paypal_amount_mismatch", {
      orderId,
      expected: centsToValue(plan.price_cents),
      got: capture.amount,
    });
  }

  const result = await grantPlanPurchase(admin, {
    userId: user.id,
    plan,
    paypalOrderId: order.id,
    captureId: capture.id,
    meta: amountMismatch ? { amountMismatch: true } : undefined,
  });

  if (result.outcome === "error") {
    // Captured but not recorded — the webhook retry will reconcile; tell the
    // user support has it rather than prompting them to pay again.
    return NextResponse.json({ error: "grant_failed" }, { status: 500 });
  }

  revalidatePath("/dashboard");
  revalidatePath("/profile");
  revalidatePath("/", "layout");

  return NextResponse.json({
    status: "COMPLETED",
    plan: plan.name,
    currentPeriodEnd:
      result.outcome === "granted" ? result.currentPeriodEnd : null,
  });
}
