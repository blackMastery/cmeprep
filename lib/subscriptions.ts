import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { computePeriodEnd, stackBase } from "@/lib/subscriptions-core";
import type { Plan, Profile } from "@/lib/supabase/types";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Postgres unique-violation — the race-loser's signal to stand down. */
const UNIQUE_VIOLATION = "23505";

async function getProfile(
  admin: AdminClient,
  userId: string
): Promise<Profile | null> {
  const { data } = await admin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  return (data as Profile | null) ?? null;
}

/**
 * Role rule — NOT the entitlement rule. ANY subscription row with
 * status='active' AND current_period_end > now() ⇒ 'student'; otherwise ⇒
 * 'trial'. Admins are never auto-changed; manual role edits stand until the
 * next subscription mutation for that user runs this sync again.
 *
 * Since exam scoping, role only means "has some paid access". WHICH exams
 * that access covers is lib/entitlements-core.ts's job, and role must never
 * become a second, weaker source of truth for it.
 *
 * Shared by the admin subscription actions and the PayPal purchase flow —
 * `actorId` is whoever caused the mutation (an admin, or the buyer).
 */
export async function syncRoleFromSubscriptions(
  admin: AdminClient,
  actorId: string,
  userId: string
): Promise<void> {
  const target = await getProfile(admin, userId);
  if (!target || target.role === "admin") return;

  const { count } = await admin
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("current_period_end", new Date().toISOString());

  const next = (count ?? 0) > 0 ? "student" : "trial";
  if (next === target.role) return;

  const { error } = await admin
    .from("profiles")
    .update({ role: next, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (!error) {
    await audit(actorId, "user.role_change", userId, {
      before: target.role,
      after: next,
      via: "subscription_sync",
    });
  }
}

/**
 * Latest active period end for ONE exam, or null when that exam has no live
 * access.
 *
 * Matching is STRICT on exam_id, `null` included: an all-access row does not
 * extend an exam-scoped purchase, and an exam-scoped row does not extend an
 * all-access grant. They are independent products with independent end dates,
 * and cross-stacking would push a paid period out past the money that bought
 * it. Buying a DIFFERENT exam therefore starts fresh at now().
 */
export async function activePeriodEndForExam(
  admin: AdminClient,
  userId: string,
  examId: string | null
): Promise<string | null> {
  let query = admin
    .from("subscriptions")
    .select("current_period_end")
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("current_period_end", new Date().toISOString())
    .order("current_period_end", { ascending: false })
    .limit(1);

  // PostgREST: .eq(col, null) does NOT emit `IS NULL` — it emits `eq.null`,
  // which never matches. The all-access branch has to use .is().
  query = examId === null ? query.is("exam_id", null) : query.eq("exam_id", examId);

  const { data } = await query.maybeSingle();
  return data?.current_period_end ?? null;
}

export type GrantResult =
  | { outcome: "granted"; subscriptionId: string; currentPeriodEnd: string }
  | { outcome: "duplicate" }
  | { outcome: "error" };

/**
 * Record a completed PayPal purchase: insert the subscription row and flip
 * the buyer's role. Idempotent on the PayPal order id — the capture route
 * and the webhook may both call this for the same order; whoever loses the
 * race gets "duplicate", which callers treat as success.
 *
 * Stacking is PER EXAM: a buyer already active on this exam starts the new
 * period at that exam's current period end, never at now() — they paid for
 * full months and repurchasing must not eat remaining time. Buying a
 * different exam starts fresh.
 */
export async function grantPlanPurchase(
  admin: AdminClient,
  input: {
    userId: string;
    plan: Pick<Plan, "id" | "name" | "duration_months">;
    /**
     * The exam bought. null ONLY for legacy two-segment custom_ids that were
     * in flight at PayPal when exam scoping shipped — those were sold under
     * blanket terms, so they grant all-access.
     */
    examId: string | null;
    paypalOrderId: string;
    captureId: string | null;
    meta?: Record<string, unknown>;
  }
): Promise<GrantResult> {
  const { userId, plan, examId, paypalOrderId, captureId } = input;
  if (plan.duration_months === null) return { outcome: "error" };

  const { data: existing } = await admin
    .from("subscriptions")
    .select("id")
    .eq("paypal_subscription_id", paypalOrderId)
    .maybeSingle();
  if (existing) return { outcome: "duplicate" };

  // The money is already captured by the time we get here, so an exam that
  // vanished mid-checkout must NOT be quietly downgraded to all-access —
  // fail loudly and let support reconcile, same posture as the plan-vanished
  // path in the capture route. exam_id's ON DELETE RESTRICT makes this all
  // but unreachable for any exam that has ever been sold.
  if (examId !== null) {
    const { data: exam } = await admin
      .from("exams")
      .select("id")
      .eq("id", examId)
      .maybeSingle();
    if (!exam) {
      console.error("paypal_grant_unknown_exam", { userId, paypalOrderId, examId });
      return { outcome: "error" };
    }
  }

  const activeEnd = await activePeriodEndForExam(admin, userId, examId);
  const periodEnd = computePeriodEnd(
    plan.duration_months,
    stackBase(activeEnd, new Date())
  ).toISOString();

  const { data, error } = await admin
    .from("subscriptions")
    .insert({
      user_id: userId,
      plan: plan.name,
      plan_id: plan.id,
      exam_id: examId,
      status: "active",
      current_period_end: periodEnd,
      paypal_subscription_id: paypalOrderId,
    })
    .select("id")
    .single();

  if (error || !data) {
    if (error?.code === UNIQUE_VIOLATION) return { outcome: "duplicate" };
    console.error("paypal_grant_failed", { userId, paypalOrderId, error });
    return { outcome: "error" };
  }

  await audit(userId, "subscription.create", userId, {
    subscriptionId: data.id,
    plan: plan.name,
    planId: plan.id,
    examId,
    currentPeriodEnd: periodEnd,
    paypalOrderId,
    captureId,
    via: "paypal",
    ...input.meta,
  });

  await syncRoleFromSubscriptions(admin, userId, userId);

  return {
    outcome: "granted",
    subscriptionId: data.id,
    currentPeriodEnd: periodEnd,
  };
}
