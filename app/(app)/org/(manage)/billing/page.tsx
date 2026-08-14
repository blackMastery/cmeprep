import type { Metadata } from "next";
import { Check } from "lucide-react";
import { listOrgSubscriptions, requireOrgAdmin } from "@/lib/orgs";
import { orgGraceEnd, orgSubscriptionState } from "@/lib/orgs-core";
import { activePeriodEnd } from "@/lib/subscriptions-core";
import { listActiveOrgPlans } from "@/lib/plans";
import { priceLabel } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OrgPayPalButtons } from "@/components/org/org-paypal-buttons";

export const metadata: Metadata = { title: "Organisation billing" };

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function OrgBillingPage() {
  const session = await requireOrgAdmin();
  const now = new Date();

  const [subs, plans] = await Promise.all([
    listOrgSubscriptions(session.org.id),
    listActiveOrgPlans(),
  ]);

  const state = orgSubscriptionState(subs, now);
  const accessEnd = activePeriodEnd(subs, now);
  // In grace the latest ACTIVE-status period has lapsed; access runs to its
  // grace end. Latest period end across active-status rows, + 14 days.
  const graceSource = subs
    .filter((s) => s.status === "active")
    .map((s) => s.current_period_end)
    .sort()
    .at(-1);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Plan status</CardTitle>
          <CardDescription>
            {state === "active" && accessEnd && (
              <>Your team&apos;s access runs until {longDate(accessEnd)}.</>
            )}
            {state === "grace" && graceSource && (
              <>
                Your plan lapsed on {longDate(graceSource)}. Access continues
                during the 14-day grace period and ends on{" "}
                {longDate(orgGraceEnd(graceSource).toISOString())} — renew
                below to keep your team studying.
              </>
            )}
            {state === "locked" &&
              "No active plan. Your members keep their accounts, but org access is off until a plan is active."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Badge
            variant={state === "active" ? "default" : "secondary"}
            className={state === "grace" ? "bg-sun text-ink" : undefined}
          >
            {state === "active"
              ? "Active"
              : state === "grace"
                ? "Grace period"
                : "Inactive"}
          </Badge>
          {session.org.suspended_at !== null && (
            <p className="mt-3 text-sm text-destructive">
              This organisation is suspended — contact support before
              renewing.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 sm:grid-cols-2">
        {plans.map((plan) => (
          <Card key={plan.id}>
            <CardHeader>
              <CardTitle className="flex items-baseline justify-between">
                {plan.name}
                <span className="font-display text-2xl font-semibold">
                  {priceLabel(plan.price_cents)}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    {plan.period}
                  </span>
                </span>
              </CardTitle>
              {plan.description && (
                <CardDescription>{plan.description}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check
                      className="mt-0.5 size-4 shrink-0 text-teal"
                      strokeWidth={3}
                      aria-hidden="true"
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              {/* Renewals STACK: a new period starts at the current period
                  end, so renewing early never eats paid time. */}
              <OrgPayPalButtons planId={plan.id} orgId={session.org.id} />
            </CardContent>
          </Card>
        ))}
        {plans.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No organisation plans are on sale right now — contact
            support@cmeprep.me for terms.
          </p>
        )}
      </div>
    </div>
  );
}
