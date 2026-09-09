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

// The pure picking rules live in lib/plans-core.ts so the expiry email and
// the expiry banner share one renew link; re-exported here for the pages that
// already import them from this module.
export { paidPlans, renewHref, renewPlan, upsellPlan } from "@/lib/plans-core";
