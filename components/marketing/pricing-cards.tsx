import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const PLANS = [
  {
    name: "Trial",
    price: "$0",
    period: "free forever",
    description: "See the question quality before paying anything.",
    features: [
      "10 questions from the bank",
      "2 timed practice tests",
      "Full explanations",
    ],

    cta: "Start free",
    href: "/register",
    featured: false,
  },
  {
    name: "1 month",
    price: "$144",
    period: "one month access",
    description: "Everything, for the month before your exam.",
    features: [
      "Unlimited questions, 7 question banks",
      "1 OSCE station bank",
      "Timed mock exams with instant scoring",
      "Real-time analytics & study plans",
    ],
    cta: "Choose 1 month",
    href: "/register",
    featured: false,
  },
  {
    name: "3 months",
    price: "$216",
    period: "three months access",
    description: "The full run-up, at half the monthly rate.",
    features: [
      "Everything in 1 month",
      "Three full months of access",
      "Adaptive bank that evolves with you",
      "New questions as they're added",
    ],
    cta: "Choose 3 months",
    href: "/register",
    featured: true,
  },
];

export function PricingCards() {
  return (
    <div className="mt-12 grid gap-6 lg:grid-cols-3">
      {PLANS.map((plan) => (
        <div
          key={plan.name}
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
              {plan.price}
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
            <Link href={plan.href}>{plan.cta}</Link>
          </Button>
        </div>
      ))}
    </div>
  );
}
