import type { Plan } from "@/lib/supabase/types";

/**
 * Pure plan-picking rules. lib/plans.ts (server-only) re-exports them for the
 * pages that already import from there; this module exists so the expiry
 * reminder email (lib/notification-scans.ts) and the in-app expiry banner
 * (components/subscriptions/expiry-banners.tsx) build the SAME renew link
 * from the same rule — and so vitest can pin it.
 */

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
/** Sellable at checkout: paid AND with a duration to grant. The one
 * statement both the upsell CTA and the renewal link build from. */
export function buyablePlans(plans: Plan[]): Plan[] {
  return paidPlans(plans).filter((p) => p.duration_months !== null);
}

export function upsellPlan(plans: Plan[]): Plan | null {
  return (
    buyablePlans(plans).sort(
      (a, b) =>
        Number(b.featured) - Number(a.featured) || a.price_cents - b.price_cents
    )[0] ?? null
  );
}

/**
 * The plan an expiry warning renews INTO: the first paid plan with a
 * duration, in storefront order. Deliberately not upsellPlan — a renewal
 * should offer the ordinary product, not the featured upsell.
 */
export function renewPlan(plans: Plan[]): Plan | null {
  return buyablePlans(plans)[0] ?? null;
}

/**
 * Site-relative renew link. Deep-links straight back to the same exam when
 * there is one — that is what the exam id bought us; before it, renewal
 * could only point at the pricing section. No plan at all (nothing on sale)
 * falls back to pricing.
 */
export function renewHref(plan: Plan | null, examId: string | null): string {
  if (!plan) return "/#pricing";
  return examId ? `/checkout/${plan.id}?exam=${examId}` : `/checkout/${plan.id}`;
}
