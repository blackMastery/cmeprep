import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import {
  capturePaypalOrder,
  getPaypalOrder,
  type PaypalOrder,
} from "@/lib/paypal";
import { parseCaptureAmount } from "@/lib/payments-core";
import {
  recordCapturedOrgPurchase,
  recordCapturedPurchase,
} from "@/lib/subscriptions";
import { parseAnyPurchaseCustomId } from "@/lib/subscriptions-core";

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
  const parsed = parseAnyPurchaseCustomId(
    capture?.custom_id ?? unit?.custom_id
  );
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
  const { cents, currency } = parseCaptureAmount(capture.amount);
  const shared = {
    userId: user.id,
    planId: parsed.planId,
    paypalOrderId: order.id,
    captureId: capture.id,
    customId: capture.custom_id ?? unit?.custom_id ?? null,
    amountCents: cents,
    currency,
    capturedAt: capture.create_time ?? null,
    source: "capture_route" as const,
  };

  // ── Org purchase: same money-first discipline, org-side tables ──
  if (parsed.kind === "org") {
    const result = await recordCapturedOrgPurchase(admin, {
      ...shared,
      orgId: parsed.orgId,
      examId: parsed.examId,
    });

    if (result.outcome === "error") {
      const error =
        result.reason === "unknown_plan" || result.reason === "no_duration"
          ? "plan_unavailable"
          : "grant_failed";
      return NextResponse.json({ error }, { status: 500 });
    }

    revalidatePath("/org", "layout");
    revalidatePath("/dashboard");

    return NextResponse.json({
      status: "COMPLETED",
      plan: result.plan.name,
      currentPeriodEnd:
        result.outcome === "granted" ? result.currentPeriodEnd : null,
    });
  }

  // A two-segment custom_id means the order was created before exam scoping
  // shipped. It grants all-access, because that is what the buyer paid for.
  // Logged so we can confirm the window has closed and drop the branch.
  if (parsed.examId === null) {
    console.warn("paypal_legacy_custom_id", { orderId, userId: parsed.userId });
  }

  // Records the money BEFORE resolving the plan. The old order returned
  // plan_unavailable here with the capture already settled and nothing written
  // down anywhere but a log line.
  const result = await recordCapturedPurchase(admin, {
    ...shared,
    examId: parsed.examId,
  });

  if (result.outcome === "error") {
    // Captured, and now RECORDED whichever way it failed — findable with
    // `select … from payments where subscription_id is null`, and repaired by
    // the reconciliation sweep. The webhook retry may still beat it there, so
    // the buyer is told support has it rather than prompted to pay again.
    const error =
      result.reason === "unknown_plan" || result.reason === "no_duration"
        ? "plan_unavailable"
        : "grant_failed";
    return NextResponse.json({ error }, { status: 500 });
  }

  revalidatePath("/dashboard");
  revalidatePath("/profile");
  revalidatePath("/", "layout");

  return NextResponse.json({
    status: "COMPLETED",
    plan: result.plan.name,
    currentPeriodEnd:
      result.outcome === "granted" ? result.currentPeriodEnd : null,
  });
}
