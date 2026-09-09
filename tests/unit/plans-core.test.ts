import { describe, expect, it } from "vitest";
import { paidPlans, renewHref, renewPlan, upsellPlan } from "@/lib/plans-core";
import type { Plan } from "@/lib/supabase/types";

const plan = (over: Partial<Plan>): Plan => ({
  id: "p",
  name: "Plan",
  price_cents: 1000,
  period: "month",
  description: null,
  features: [],
  duration_months: 1,
  featured: false,
  is_active: true,
  position: 0,
  kind: "personal",
  seat_limit: null,
  updated_at: null,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

describe("plans-core", () => {
  const free = plan({ id: "free", price_cents: 0 });
  const monthly = plan({ id: "monthly", price_cents: 1200, position: 1 });
  const annual = plan({ id: "annual", price_cents: 14400, featured: true, position: 2 });
  const bespoke = plan({ id: "bespoke", price_cents: 500, duration_months: null });

  it("paidPlans drops the free tier", () => {
    expect(paidPlans([free, monthly]).map((p) => p.id)).toEqual(["monthly"]);
  });

  it("upsellPlan prefers featured, then cheapest, and needs a duration", () => {
    expect(upsellPlan([free, monthly, annual, bespoke])?.id).toBe("annual");
    expect(upsellPlan([free, monthly, bespoke])?.id).toBe("monthly");
    expect(upsellPlan([free, bespoke])).toBeNull();
  });

  it("renewPlan is the first paid plan with a duration, in storefront order", () => {
    expect(renewPlan([free, monthly, annual])?.id).toBe("monthly");
    expect(renewPlan([free, bespoke])).toBeNull();
  });

  it("renewHref deep-links the exam and falls back to pricing", () => {
    expect(renewHref(monthly, "exam-1")).toBe("/checkout/monthly?exam=exam-1");
    expect(renewHref(monthly, null)).toBe("/checkout/monthly");
    expect(renewHref(null, "exam-1")).toBe("/#pricing");
  });
});
