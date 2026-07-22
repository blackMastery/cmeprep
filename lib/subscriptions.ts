import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { computePeriodEnd } from "@/lib/subscriptions-core";
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
 * Entitlement rule: ANY subscription row with status='active' AND
 * current_period_end > now() ⇒ 'student'; otherwise ⇒ 'trial'.
 * Admins are never auto-changed; manual role edits stand until the next
 * subscription mutation for that user runs this sync again.
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

/** Latest active period end for a user, or null when nothing is active. */
export async function activePeriodEndForUser(
  admin: AdminClient,
  userId: string
): Promise<string | null> {
  const { data } = await admin
    .from("subscriptions")
    .select("current_period_end")
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("current_period_end", new Date().toISOString())
    .order("current_period_end", { ascending: false })
    .limit(1)
    .maybeSingle();
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
 * Stacking: a buyer who is already active starts the new period at their
 * current period end, never at now() — they paid for full months and
 * repurchasing must not eat remaining time.
 */
export async function grantPlanPurchase(
  admin: AdminClient,
  input: {
    userId: string;
    plan: Pick<Plan, "id" | "name" | "duration_months">;
    paypalOrderId: string;
    captureId: string | null;
    meta?: Record<string, unknown>;
  }
): Promise<GrantResult> {
  const { userId, plan, paypalOrderId, captureId } = input;
  if (plan.duration_months === null) return { outcome: "error" };

  const { data: existing } = await admin
    .from("subscriptions")
    .select("id")
    .eq("paypal_subscription_id", paypalOrderId)
    .maybeSingle();
  if (existing) return { outcome: "duplicate" };

  const activeEnd = await activePeriodEndForUser(admin, userId);
  const now = new Date();
  const base =
    activeEnd && new Date(activeEnd) > now ? new Date(activeEnd) : now;
  const periodEnd = computePeriodEnd(plan.duration_months, base).toISOString();

  const { data, error } = await admin
    .from("subscriptions")
    .insert({
      user_id: userId,
      plan: plan.name,
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
