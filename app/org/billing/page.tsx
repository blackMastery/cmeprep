import type { Metadata } from "next";
import { Check } from "lucide-react";
import { listOrgSubscriptions, requireOrgAdmin } from "@/lib/orgs";
import { orgGraceEnd, orgSubscriptionState } from "@/lib/orgs-core";
import { activePeriodEnd } from "@/lib/subscriptions-core";
import { accessEndsByExam } from "@/lib/entitlements-core";
import { listExamCatalogTree } from "@/lib/catalog";
import { sellableExams, toExamSummary } from "@/lib/catalog-core";
import { listActiveOrgPlans } from "@/lib/plans";
import { priceLabel } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ExamChoice } from "@/components/checkout/exam-choice";
import { ExamDetailPanel } from "@/components/checkout/exam-detail-panel";
import { OrgPayPalButtons } from "@/components/org/org-paypal-buttons";

export const metadata: Metadata = { title: "Billing" };

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : undefined;
}

export default async function OrgBillingPage(
  props: PageProps<"/org/billing">
) {
  const session = await requireOrgAdmin();
  const sp = await props.searchParams;
  const now = new Date();

  const [subs, plans, tree] = await Promise.all([
    listOrgSubscriptions(session.org.id),
    listActiveOrgPlans(),
    listExamCatalogTree(),
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

  // Same picker as the personal checkout: an org buys ONE public exam per
  // purchase. sellableExams keeps retired exams and private banks out —
  // renewing a retired exam is a support/manual-grant path.
  const catalog = sellableExams(tree);
  const requested = one(sp.exam);
  const selected =
    catalog.find((exam) => exam.id === requested) ??
    (catalog.length === 1 ? catalog[0] : null);

  // Per-exam "owned until" badges. Deliberately the PAID period end (grace is
  // the banner's story, not a second date here); the null key is a comp
  // all-access row and applies to every exam.
  const endsByExam = accessEndsByExam(subs, now);
  const allAccessEnd = endsByExam.get(null);
  const ownedUntil: Record<string, string> = {};
  for (const exam of catalog) {
    const end = endsByExam.get(exam.id) ?? allAccessEnd;
    if (end) ownedUntil[exam.id] = shortDate(end);
  }
  const extendsFrom = selected
    ? (endsByExam.get(selected.id) ?? null)
    : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Plan status</CardTitle>
          <CardDescription>
            {state === "active" && accessEnd && (
              <>
                Your team&apos;s latest access period runs until{" "}
                {longDate(accessEnd)}. Access is per examination — each
                exam&apos;s dates are shown in the picker below.
              </>
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

      <Card>
        <CardHeader>
          <CardTitle id="org-exam-choice-heading">
            Choose an examination
          </CardTitle>
          <CardDescription>
            Each purchase covers one examination for your whole team. Buying
            the same exam again extends it; a different exam is its own
            purchase.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExamChoice
            basePath="/org/billing"
            exams={catalog.map(toExamSummary)}
            selectedId={selected?.id ?? null}
            ownedUntil={ownedUntil}
            labelledBy="org-exam-choice-heading"
          >
            {selected && <ExamDetailPanel exam={selected} />}
          </ExamChoice>
          {catalog.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No examinations are on sale right now — contact
              support@cmeqbank.com.
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
              {selected ? (
                <>
                  {extendsFrom && (
                    <p className="text-sm text-muted-foreground">
                      Your team already holds {selected.name} — this purchase
                      extends it from {shortDate(extendsFrom)}. {/* Renewals
                      STACK per exam: the new period starts at that exam's
                      current end, so renewing early never eats paid time. */}
                    </p>
                  )}
                  <OrgPayPalButtons
                    planId={plan.id}
                    orgId={session.org.id}
                    examId={selected.id}
                  />
                </>
              ) : (
                <Button disabled className="w-full" size="lg">
                  Select an examination to continue
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
        {plans.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No organisation plans are on sale right now — contact
            support@cmeqbank.com for terms.
          </p>
        )}
      </div>
    </div>
  );
}
