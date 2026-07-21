import type { Metadata } from "next";
import { listAllPlans } from "@/lib/admin/plans";
import { PlanManager } from "@/components/admin/plan-manager";

export const metadata: Metadata = { title: "Payment plans" };

export default async function AdminPlansPage() {
  const plans = await listAllPlans();

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Payment plans
        </h1>
        <p className="mt-1 text-muted-foreground">
          Shown on the marketing pricing section and offered as presets when
          granting subscriptions. Changes go live immediately.
        </p>
      </header>

      <PlanManager plans={plans} />
    </div>
  );
}
