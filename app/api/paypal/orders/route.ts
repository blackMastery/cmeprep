import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import {
  createOrgPaypalOrderSchema,
  createPaypalOrderSchema,
} from "@/lib/validation";
import { createPaypalOrder } from "@/lib/paypal";
import {
  centsToValue,
  formatOrgPurchaseCustomId,
  formatPurchaseCustomId,
} from "@/lib/subscriptions-core";

/**
 * POST /api/paypal/orders — create a PayPal order for a plan.
 *
 * Server-authoritative: the amount comes from the plans table, and the
 * buyer/plan/exam (or buyer/plan/org) tuple rides along in the purchase
 * unit's custom_id so the capture route and webhook can re-derive it from
 * PayPal, not the client. The body shape picks the storefront: {planId,
 * examId} is a personal purchase, {planId, orgId} an org one.
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

  const isOrgBody =
    typeof body === "object" && body !== null && "orgId" in body;
  const parsed = isOrgBody
    ? null
    : createPaypalOrderSchema.safeParse(body);
  const parsedOrg = isOrgBody
    ? createOrgPaypalOrderSchema.safeParse(body)
    : null;

  const active = parsed ?? parsedOrg!;
  if (!active.success) {
    return NextResponse.json(
      { error: active.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("plans")
    .select("*")
    .eq("id", active.data.planId)
    .maybeSingle();

  // Self-serve checkout needs an active paid plan it can compute an end date
  // for; null-duration plans stay admin-granted. kind keeps the storefronts
  // apart: an org plan through the personal flow would grant one seat for 90
  // seats' money, the reverse a 90-seat org for pocket change.
  if (
    !plan ||
    !plan.is_active ||
    plan.price_cents <= 0 ||
    plan.duration_months === null ||
    plan.kind !== (parsedOrg ? "org" : "personal")
  ) {
    return NextResponse.json({ error: "plan_unavailable" }, { status: 404 });
  }

  // ── Org purchase: only that org's admins may put money on it ──
  if (parsedOrg?.success) {
    const { orgId } = parsedOrg.data;
    const { data: membership } = await admin
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (membership?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: org } = await admin
      .from("orgs")
      .select("id, suspended_at")
      .eq("id", orgId)
      .maybeSingle();
    // A suspended org must talk to support, not renew its way back in.
    if (!org || org.suspended_at !== null) {
      return NextResponse.json({ error: "org_unavailable" }, { status: 404 });
    }

    const order = await createPaypalOrder({
      value: centsToValue(plan.price_cents),
      customId: formatOrgPurchaseCustomId(user.id, plan.id, orgId),
      referenceId: plan.id,
    });
    if (!order) {
      return NextResponse.json({ error: "paypal_unavailable" }, { status: 502 });
    }
    return NextResponse.json({ id: order.id }, { status: 201 });
  }

  // ── Personal purchase ──
  if (!parsed?.success) {
    // Unreachable — the org branch returned above — but keeps TS honest.
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // The browser picks the exam, so it has to be checked here: an unvalidated
  // id would ride into custom_id and only blow up on the FK AFTER the money
  // is captured. is_active is enforced at THIS end of the flow only — once a
  // payment is captured the grant honours it regardless, so retiring an exam
  // mid-checkout never takes money without handing over the goods. Org exams
  // have is_active but are never sold — the org_id filter is the wall.
  const { data: exam } = await admin
    .from("exams")
    .select("id")
    .eq("id", parsed.data.examId)
    .eq("is_active", true)
    .is("org_id", null)
    .maybeSingle();

  if (!exam) {
    return NextResponse.json({ error: "exam_unavailable" }, { status: 404 });
  }

  const order = await createPaypalOrder({
    value: centsToValue(plan.price_cents),
    customId: formatPurchaseCustomId(user.id, plan.id, exam.id),
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
