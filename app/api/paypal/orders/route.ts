import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { createPaypalOrderSchema } from "@/lib/validation";
import { createPaypalOrder } from "@/lib/paypal";
import {
  centsToValue,
  formatPurchaseCustomId,
} from "@/lib/subscriptions-core";

/**
 * POST /api/paypal/orders — create a PayPal order for a plan.
 *
 * Server-authoritative: the amount comes from the plans table, and the
 * buyer/plan pair rides along in the purchase unit's custom_id so the
 * capture route and webhook can re-derive it from PayPal, not the client.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (user.profile.banned_at) {
    return NextResponse.json({ error: "Account suspended" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createPaypalOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("plans")
    .select("*")
    .eq("id", parsed.data.planId)
    .maybeSingle();

  // Self-serve checkout needs an active paid plan it can compute an end date
  // for; null-duration plans stay admin-granted.
  if (
    !plan ||
    !plan.is_active ||
    plan.price_cents <= 0 ||
    plan.duration_months === null
  ) {
    return NextResponse.json({ error: "plan_unavailable" }, { status: 404 });
  }

  const order = await createPaypalOrder({
    value: centsToValue(plan.price_cents),
    customId: formatPurchaseCustomId(user.id, plan.id),
    referenceId: plan.id,
  });

  if (!order) {
    return NextResponse.json(
      { error: "paypal_unavailable" },
      { status: 502 }
    );
  }

  return NextResponse.json({ id: order.id }, { status: 201 });
}
