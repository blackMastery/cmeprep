import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { dispatchPaypalEvent, type WebhookEvent } from "@/lib/paypal-events";
import { grantPlanPurchase } from "@/lib/subscriptions";
import {
  emptyPass,
  hasBudget,
  summarizeSweep,
  BUDGET_MS,
  EVENT_BATCH,
  MAX_REPLAY_ATTEMPTS,
  REPLAY_DELAY_MINUTES,
  UNCLAIMED_BATCH,
  type PassResult,
  type SweepSummary,
} from "@/lib/reconcile-core";
import type { Payment } from "@/lib/supabase/types";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * The reconciliation sweep named in exam-app-development-plan.md's risk
 * register. Two things go wrong that nothing else notices:
 *
 *  A. A webhook delivery arrived and its handler threw. The payment_events row
 *     keeps processed_at null on purpose so it stays findable — and until now
 *     nothing looked.
 *  B. A capture was recorded but never became a subscription. Money taken, no
 *     access, and the buyer emails support rather than the system noticing.
 *
 * Designed for CATCH-UP, never incremental: it queries all outstanding work
 * every time, with no watermark anywhere, so a dropped invocation self-heals on
 * the next run. Overlapping runs are safe — every operation is idempotent —
 * just wasteful.
 */

const MAX_ERROR_CHARS = 500;

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export async function runReconciliationSweep(options?: {
  budgetMs?: number;
}): Promise<SweepSummary> {
  const startedAt = Date.now();
  const deadline = startedAt + (options?.budgetMs ?? BUDGET_MS);
  const admin = createAdminClient();

  const events = await replayStuckEvents(admin, deadline);
  const unclaimedPayments = await repairUnclaimedPayments(admin, deadline);

  const summary = summarizeSweep({
    durationMs: Date.now() - startedAt,
    truncated: !hasBudget(deadline, Date.now()),
    events,
    unclaimedPayments,
  });

  // Written every run, even a clean one: a heartbeat in audit_logs is the only
  // way anyone notices the cron has silently stopped.
  await audit(null, "payment.reconcile", null, { ...summary });

  return summary;
}

/** Pass A — re-run handlers for deliveries that threw. */
async function replayStuckEvents(
  admin: AdminClient,
  deadline: number
): Promise<PassResult> {
  const result = emptyPass();

  const { data: rows, error } = await admin
    .from("payment_events")
    .select("id, paypal_event_id, type, payload, replay_attempts")
    .is("processed_at", null)
    .lt("replay_attempts", MAX_REPLAY_ATTEMPTS)
    .lt("created_at", isoMinutesAgo(REPLAY_DELAY_MINUTES))
    .order("created_at", { ascending: true })
    .limit(EVENT_BATCH);

  if (error) {
    console.error("reconcile_event_scan_failed", { error });
    result.failed += 1;
    return result;
  }

  // Reported so an operator sees a growing number rather than silence. Counted
  // separately from the batch, because these are excluded from it.
  const { count: stuck } = await admin
    .from("payment_events")
    .select("id", { count: "exact", head: true })
    .is("processed_at", null)
    .gte("replay_attempts", MAX_REPLAY_ATTEMPTS);
  result.quarantined = stuck ?? 0;

  for (const row of rows ?? []) {
    if (!hasBudget(deadline, Date.now())) break;
    result.scanned += 1;

    // Claim BEFORE working: a run killed by the platform timeout still burns an
    // attempt, so a row that reliably kills the function cannot loop forever.
    await admin
      .from("payment_events")
      .update({
        replay_attempts: row.replay_attempts + 1,
        last_attempt_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    try {
      // The stored payload IS the whole event; the columns are the indexed
      // truth, so they win over anything in the JSON.
      await dispatchPaypalEvent(admin, {
        ...(row.payload as Record<string, unknown>),
        id: row.paypal_event_id,
        event_type: row.type,
      } as WebhookEvent);

      await admin
        .from("payment_events")
        .update({ processed_at: new Date().toISOString(), last_error: null })
        .eq("id", row.id);

      result.repaired += 1;
      await audit(null, "payment.reconcile_repair", null, {
        paypalEventId: row.paypal_event_id,
        type: row.type,
        attempt: row.replay_attempts + 1,
      });
    } catch (error) {
      // One bad event never aborts the sweep.
      result.failed += 1;
      const message = String(
        error instanceof Error ? error.message : error
      ).slice(0, MAX_ERROR_CHARS);
      console.error("reconcile_event_replay_failed", {
        paypalEventId: row.paypal_event_id,
        type: row.type,
        attempt: row.replay_attempts + 1,
        error,
      });
      await admin
        .from("payment_events")
        .update({ last_error: message })
        .eq("id", row.id);
    }
  }

  return result;
}

/** Pass B — money captured that never became a subscription. */
async function repairUnclaimedPayments(
  admin: AdminClient,
  deadline: number
): Promise<PassResult> {
  const result = emptyPass();

  const { data: rows, error } = await admin
    .from("payments")
    .select("*")
    .is("subscription_id", null)
    // Only money the buyer is still owed access for. A denied capture never
    // funded, a reversed one was charged back, and a fully refunded one has
    // been handed back — granting against any of those would be a gift.
    // partially_refunded stays in: they paid, and they are still owed.
    .in("status", ["captured", "partially_refunded"])
    .lt("created_at", isoMinutesAgo(REPLAY_DELAY_MINUTES))
    .order("created_at", { ascending: true })
    .limit(UNCLAIMED_BATCH);

  if (error) {
    console.error("reconcile_payment_scan_failed", { error });
    result.failed += 1;
    return result;
  }

  for (const payment of (rows ?? []) as Payment[]) {
    if (!hasBudget(deadline, Date.now())) break;
    result.scanned += 1;

    try {
      const repaired = await repairPayment(admin, payment);
      if (repaired) result.repaired += 1;
      else result.failed += 1;
    } catch (error) {
      result.failed += 1;
      console.error("reconcile_payment_repair_failed", {
        paymentId: payment.id,
        error,
      });
    }
  }

  return result;
}

async function repairPayment(
  admin: AdminClient,
  payment: Payment
): Promise<boolean> {
  // The common case: the grant succeeded and only the link write was lost.
  const { data: sub } = await admin
    .from("subscriptions")
    .select("id, exam_id")
    .eq("paypal_subscription_id", payment.paypal_order_id)
    .maybeSingle();

  if (sub) {
    await linkPayment(admin, payment, sub.id, sub.exam_id);
    await audit(payment.user_id, "payment.reconcile_repair", payment.user_id, {
      paymentId: payment.id,
      paypalOrderId: payment.paypal_order_id,
      subscriptionId: sub.id,
      reason: "link_only",
    });
    return true;
  }

  // No subscription at all — this is the buyer with no access.
  if (!payment.plan_id) {
    console.error("reconcile_unclaimed_payment_unknown_plan", {
      paymentId: payment.id,
      paypalOrderId: payment.paypal_order_id,
      customId: payment.custom_id,
    });
    await audit(payment.user_id, "payment.reconcile_failed", payment.user_id, {
      paymentId: payment.id,
      paypalOrderId: payment.paypal_order_id,
      reason: "unknown_plan",
    });
    return false;
  }

  if (!payment.user_id) {
    console.error("reconcile_unclaimed_payment_unknown_user", {
      paymentId: payment.id,
      customId: payment.custom_id,
    });
    await audit(null, "payment.reconcile_failed", null, {
      paymentId: payment.id,
      paypalOrderId: payment.paypal_order_id,
      reason: "unknown_user",
    });
    return false;
  }

  const { data: plan } = await admin
    .from("plans")
    .select("*")
    .eq("id", payment.plan_id)
    .maybeSingle();

  // Never guess a duration — a bespoke plan has no months to grant.
  if (!plan || plan.duration_months === null) {
    console.error("reconcile_unclaimed_payment_unknown_plan", {
      paymentId: payment.id,
      planId: payment.plan_id,
    });
    await audit(payment.user_id, "payment.reconcile_failed", payment.user_id, {
      paymentId: payment.id,
      paypalOrderId: payment.paypal_order_id,
      reason: plan ? "no_duration" : "unknown_plan",
    });
    return false;
  }

  // Idempotent on the order id, so a webhook doing the same thing concurrently
  // yields "duplicate", which is success.
  const grant = await grantPlanPurchase(admin, {
    userId: payment.user_id,
    plan,
    examId: payment.exam_id,
    paypalOrderId: payment.paypal_order_id,
    captureId: payment.paypal_capture_id,
    meta: { via: "reconcile_sweep", paymentId: payment.id },
  });

  if (grant.outcome === "error") {
    await audit(payment.user_id, "payment.reconcile_failed", payment.user_id, {
      paymentId: payment.id,
      paypalOrderId: payment.paypal_order_id,
      reason: grant.reason,
    });
    return false;
  }

  await linkPayment(admin, payment, grant.subscriptionId, grant.examId);
  await audit(payment.user_id, "payment.reconcile_repair", payment.user_id, {
    paymentId: payment.id,
    paypalOrderId: payment.paypal_order_id,
    subscriptionId: grant.subscriptionId,
    granted: grant.outcome === "granted",
  });
  return true;
}

async function linkPayment(
  admin: AdminClient,
  payment: Payment,
  subscriptionId: string,
  examId: string | null
): Promise<void> {
  const { error } = await admin
    .from("payments")
    // `source` is deliberately left alone: it records where the money was first
    // seen, which stays true. That the sweep did the repair is the audit row's
    // job.
    .update({
      subscription_id: subscriptionId,
      exam_id: examId,
      grant_failure: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payment.id);
  if (error) throw new Error(error.message);
}
