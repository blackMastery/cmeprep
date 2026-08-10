import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { CURRENCY } from "@/lib/paypal";
import { checkCaptureAmount } from "@/lib/payments-core";
import { recordCapture, recordPaymentGrant } from "@/lib/payments";
import { computePeriodEnd, stackBase } from "@/lib/subscriptions-core";
import type { PaymentSource, Plan, Profile } from "@/lib/supabase/types";

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

/**
 * Why a grant did not happen. Typed rather than a bare "error" so the payment
 * row can say WHICH way it failed without support reconstructing it from logs.
 */
export type GrantFailure =
  | "unknown_plan"
  | "no_duration"
  | "unknown_exam"
  | "insert_failed";

export type GrantResult =
  | {
      outcome: "granted";
      subscriptionId: string;
      currentPeriodEnd: string;
      examId: string | null;
    }
  | { outcome: "duplicate"; subscriptionId: string; examId: string | null }
  | { outcome: "error"; reason: GrantFailure };

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
  if (plan.duration_months === null) {
    return { outcome: "error", reason: "no_duration" };
  }

  const { data: existing } = await admin
    .from("subscriptions")
    .select("id, exam_id")
    .eq("paypal_subscription_id", paypalOrderId)
    .maybeSingle();
  if (existing) {
    // exam_id read back from the row, not from the caller: the payment link is
    // written from it, and an unresolved id would trip the FK.
    return {
      outcome: "duplicate",
      subscriptionId: existing.id,
      examId: existing.exam_id,
    };
  }

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
      return { outcome: "error", reason: "unknown_exam" };
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
    if (error?.code === UNIQUE_VIOLATION) {
      // The race-loser re-reads the winner's row so the payment still links.
      const { data: winner } = await admin
        .from("subscriptions")
        .select("id, exam_id")
        .eq("paypal_subscription_id", paypalOrderId)
        .maybeSingle();
      if (winner) {
        return {
          outcome: "duplicate",
          subscriptionId: winner.id,
          examId: winner.exam_id,
        };
      }
    }
    console.error("paypal_grant_failed", { userId, paypalOrderId, error });
    return { outcome: "error", reason: "insert_failed" };
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
    examId,
  };
}

export type CapturedOrder = {
  userId: string;
  /** From custom_id, so unvalidated until the plan is read back. */
  planId: string;
  examId: string | null;
  paypalOrderId: string;
  captureId: string | null;
  customId: string | null;
  amountCents: number | null;
  currency: string | null;
  capturedAt: string | null;
  source: PaymentSource;
};

export type PurchaseOutcome =
  | {
      outcome: "granted";
      paymentId: string | null;
      plan: Plan;
      subscriptionId: string;
      currentPeriodEnd: string;
    }
  | {
      outcome: "duplicate";
      paymentId: string | null;
      plan: Plan;
      subscriptionId: string;
    }
  | {
      outcome: "error";
      paymentId: string | null;
      plan: Plan | null;
      reason: GrantFailure;
    };

/**
 * Record a captured PayPal order and grant what it bought, in that order.
 *
 * THE ORDERING IS THE POINT. Every early return this replaced — plan vanished,
 * duration null, exam vanished, insert failed — happened before anything
 * durable was written, so a captured payment could disappear into a
 * console.error. The payment row is now written FIRST, from data that cannot
 * fail an FK, and the grant outcome is attached to it afterwards. A payments row
 * with subscription_id null is money that owes someone access, and the
 * reconciliation sweep goes looking for exactly that.
 *
 * Called by app/api/paypal/orders/[orderId]/capture/route.ts and by both grant
 * paths in lib/paypal-events.ts, which is also why the plan lookup moved in
 * here: it used to be duplicated across all three callers, and each copy was
 * its own money hole.
 *
 * grantPlanPurchase itself writes nothing to `payments`, so admin comp grants
 * stay unaffected — no 0-cent rows polluting revenue sums.
 */
export async function recordCapturedPurchase(
  admin: AdminClient,
  order: CapturedOrder
): Promise<PurchaseOutcome> {
  // First statement, before any validation.
  const payment = await recordCapture(admin, order);
  const paymentId = payment?.id ?? null;

  const { data: plan } = await admin
    .from("plans")
    .select("*")
    .eq("id", order.planId)
    .maybeSingle();

  if (!plan || plan.duration_months === null) {
    const reason: GrantFailure = !plan ? "unknown_plan" : "no_duration";
    console.error("paypal_captured_unknown_plan", {
      paypalOrderId: order.paypalOrderId,
      planId: order.planId,
      reason,
    });
    if (paymentId) {
      await recordPaymentGrant(admin, paymentId, {
        kind: "failed",
        reason,
        // A plan with no duration still identifies the product bought.
        planId: plan?.id ?? null,
        planName: plan?.name ?? null,
        planPriceCents: plan?.price_cents ?? null,
      });
    }
    await audit(order.userId, "payment.grant_failed", order.userId, {
      paymentId,
      paypalOrderId: order.paypalOrderId,
      planId: order.planId,
      reason,
      via: order.source,
    });
    return { outcome: "error", paymentId, plan: plan ?? null, reason };
  }

  // Never blocks the grant — the money is already captured. Both figures are on
  // the payments row now, so the canonical query is
  // `where amount_cents is distinct from plan_price_cents`.
  const amountCheck = checkCaptureAmount({
    cents: order.amountCents,
    currency: order.currency,
    planPriceCents: plan.price_cents,
    expectedCurrency: CURRENCY,
  });
  if (amountCheck !== "ok") {
    console.error("paypal_amount_mismatch", {
      paypalOrderId: order.paypalOrderId,
      check: amountCheck,
      expectedCents: plan.price_cents,
      got: { cents: order.amountCents, currency: order.currency },
    });
  }

  const grant = await grantPlanPurchase(admin, {
    userId: order.userId,
    plan,
    examId: order.examId,
    paypalOrderId: order.paypalOrderId,
    captureId: order.captureId,
    meta: {
      via: order.source,
      paymentId,
      ...(amountCheck !== "ok" ? { amountCheck } : {}),
      ...(order.examId === null ? { legacyCustomId: true } : {}),
    },
  });

  if (grant.outcome === "error") {
    if (paymentId) {
      await recordPaymentGrant(admin, paymentId, {
        kind: "failed",
        reason: grant.reason,
        planId: plan.id,
        planName: plan.name,
        planPriceCents: plan.price_cents,
      });
    }
    await audit(order.userId, "payment.grant_failed", order.userId, {
      paymentId,
      paypalOrderId: order.paypalOrderId,
      planId: plan.id,
      reason: grant.reason,
      via: order.source,
    });
    return { outcome: "error", paymentId, plan, reason: grant.reason };
  }

  if (paymentId) {
    await recordPaymentGrant(admin, paymentId, {
      kind: "granted",
      subscriptionId: grant.subscriptionId,
      planId: plan.id,
      planName: plan.name,
      planPriceCents: plan.price_cents,
      examId: grant.examId,
    });
  }

  return grant.outcome === "granted"
    ? {
        outcome: "granted",
        paymentId,
        plan,
        subscriptionId: grant.subscriptionId,
        currentPeriodEnd: grant.currentPeriodEnd,
      }
    : {
        outcome: "duplicate",
        paymentId,
        plan,
        subscriptionId: grant.subscriptionId,
      };
}
