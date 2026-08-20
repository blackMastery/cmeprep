import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Plan } from "@/lib/supabase/types";

/**
 * Active plans for public + learner surfaces (marketing pricing, trial-limit
 * upsell, subscription presets). Uses the RLS'd client on purpose — `plans`
 * is granted to anon, so this works for logged-out marketing visitors.
 */
export async function listActivePlans(): Promise<Plan[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("plans")
    .select("*")
    .eq("is_active", true)
    // Org plans have their own storefront (/org/billing); every existing
    // surface this feeds is personal.
    .eq("kind", "personal")
    .order("position")
    .order("name");
  return (data ?? []) as Plan[];
}

/** Active org plans — the /org/billing storefront. */
export async function listActiveOrgPlans(): Promise<Plan[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("plans")
    .select("*")
    .eq("is_active", true)
    .eq("kind", "org")
    .order("position")
    .order("name");
  return (data ?? []) as Plan[];
}

/** Paid = costs money; the free tier renders but is never a grant preset. */
export function paidPlans(plans: Plan[]): Plan[] {
  return plans.filter((p) => p.price_cents > 0);
}

/**
 * Where a locked exam's "Get access" link points: the featured paid plan,
 * else the cheapest. Checkout then offers a "Change plan" link back to
 * /#pricing, so the loop closes without a separate plan-picker route.
 *
 * Lives here rather than in a page because both /tests/new and /resources
 * put the same CTA on a locked exam and must point at the same plan.
 */
export function upsellPlan(plans: Plan[]): Plan | null {
  const buyable = paidPlans(plans).filter((p) => p.duration_months !== null);
  return (
    [...buyable].sort(
      (a, b) =>
        Number(b.featured) - Number(a.featured) || a.price_cents - b.price_cents
    )[0] ?? null
  );
}
