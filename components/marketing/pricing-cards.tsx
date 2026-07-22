import Link from "next/link";
import { Check } from "lucide-react";
import type { Plan } from "@/lib/supabase/types";
import { priceLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Plans come from the DB (managed at /admin/plans); active ones only. */
export function PricingCards({ plans }: { plans: Plan[] }) {
  return (
    <div className="mt-12 grid gap-6 lg:grid-cols-3">
      {plans.map((plan) => (
        <div
          key={plan.id}
          className={cn(
            "flex flex-col rounded-2xl p-7",
            plan.featured
              ? "bg-primary text-primary-foreground shadow-lg"
              : "bg-card ring-1 ring-foreground/10"
          )}
        >
          {plan.featured && (
            <span className="mb-4 self-start rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
              Best value
            </span>
          )}

          <h3 className="font-display text-xl font-medium">{plan.name}</h3>

          <p className="mt-3">
            <span className="font-display text-4xl font-semibold">
              {priceLabel(plan.price_cents)}
            </span>
          </p>
          <p
            className={cn(
              "mt-1 text-sm",
              plan.featured
                ? "text-primary-foreground/75"
                : "text-muted-foreground"
            )}
          >
            {plan.period}
          </p>

          <p
            className={cn(
              "mt-4 text-sm leading-relaxed",
              plan.featured
                ? "text-primary-foreground/85"
                : "text-muted-foreground"
            )}
          >
            {plan.description}
          </p>

          <ul className="mt-6 flex-1 space-y-3 text-sm">
            {plan.features.map((feature) => (
              <li key={feature} className="flex items-start gap-2.5">
                <Check
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    plan.featured ? "text-primary-foreground" : "text-success"
                  )}
                  strokeWidth={3}
                  aria-hidden="true"
                />
                <span>{feature}</span>
              </li>
            ))}
          </ul>

          <Button
            size="lg"
            variant={plan.featured ? "secondary" : "default"}
            className="mt-8 w-full"
            asChild
          >
            {/* Paid plans with a known duration go to PayPal checkout
                (proxy bounces logged-out visitors through /login?next=…);
                free and admin-granted plans start at registration. */}
            <Link
              href={
                plan.price_cents > 0 && plan.duration_months !== null
                  ? `/checkout/${plan.id}`
                  : "/register"
              }
            >
              {plan.price_cents === 0 ? "Start free" : `Choose ${plan.name}`}
            </Link>
          </Button>
        </div>
      ))}
    </div>
  );
}
