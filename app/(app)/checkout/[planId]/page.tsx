import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listExamCatalogTree } from "@/lib/catalog";
import { sellableExams, toExamSummary } from "@/lib/catalog-core";
import { accessEndsByExam } from "@/lib/entitlements-core";
import type { SubscriptionScope } from "@/lib/entitlements-core";
import { priceLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EcgDivider } from "@/components/brand/ecg-line";
import { PayPalCheckoutButtons } from "@/components/checkout/paypal-buttons";
import { ExamChoice } from "@/components/checkout/exam-choice";
import { ExamDetailPanel } from "@/components/checkout/exam-detail-panel";

export const metadata: Metadata = { title: "Checkout" };

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : undefined;
}

export default async function CheckoutPage(
  props: PageProps<"/checkout/[planId]">
) {
  const { planId } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser();
  const supabase = await createClient();

  const { data: plan } = await supabase
    .from("plans")
    .select("*")
    .eq("id", planId)
    .maybeSingle();

  // Self-serve checkout is for active paid PERSONAL plans with a known
  // duration; anything else (free, retired, admin-granted, org) has no buy
  // page here — org plans check out from /org/billing.
  if (
    !plan ||
    !plan.is_active ||
    plan.price_cents <= 0 ||
    plan.duration_months === null ||
    plan.kind !== "personal"
  ) {
    notFound();
  }

  // Retired exams are not for sale: they drop out of the picker, and a stale
  // ?exam= pointing at one falls through to "unselected" below.
  const catalog = sellableExams(await listExamCatalogTree());

  // An unknown or stale ?exam= must not dead-end the buyer — fall back to
  // unselected and let them pick. A single exam is auto-selected.
  const requested = one(sp.exam);
  const selected =
    catalog.find((exam) => exam.id === requested) ??
    (catalog.length === 1 ? catalog[0] : null);

  // RLS: users can read their own subscriptions.
  const { data: subs } = await supabase
    .from("subscriptions")
    .select("status, current_period_end, exam_id")
    .eq("user_id", user.id);

  // Per exam, not global: telling a buyer that a purchase for exam A extends
  // their access is only true for A itself, or for an all-access row.
  const endsByExam = accessEndsByExam(
    (subs ?? []) as SubscriptionScope[],
    new Date()
  );
  const allAccessEnd = endsByExam.get(null) ?? null;
  const extendsFrom = selected
    ? (endsByExam.get(selected.id) ?? allAccessEnd)
    : null;

  const ownedUntil: Record<string, string> = {};
  for (const exam of catalog) {
    const end = endsByExam.get(exam.id) ?? allAccessEnd;
    if (end) ownedUntil[exam.id] = shortDate(end);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to dashboard
      </Link>

      <Card className="[--card-spacing:--spacing(7)]">
        <CardContent className="space-y-6">
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {plan.name}
            </h1>
            <p className="text-sm text-muted-foreground">{plan.period}</p>
          </div>

          <p>
            <span className="font-display text-4xl font-semibold">
              {priceLabel(plan.price_cents)}
            </span>
            <span className="ml-2 text-sm text-muted-foreground">
              one-time payment · USD
            </span>
          </p>

          {plan.description && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {plan.description}
            </p>
          )}

          {plan.features.length > 0 && (
            <ul className="space-y-2.5 text-sm">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2.5">
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-teal"
                    strokeWidth={3}
                    aria-hidden="true"
                  />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          )}

          <EcgDivider />

          <section aria-labelledby="exam-choice-heading" className="space-y-3">
            <div>
              <h2 id="exam-choice-heading" className="font-display text-lg">
                {catalog.length === 1
                  ? "This plan covers"
                  : "Choose your examination"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Your subscription covers one examination. You can add another
                later.
              </p>
            </div>

            {catalog.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                No examinations are available yet — please check back shortly.
              </p>
            ) : (
              <ExamChoice
                planId={plan.id}
                exams={catalog.map(toExamSummary)}
                selectedId={selected?.id ?? null}
                ownedUntil={ownedUntil}
                labelledBy="exam-choice-heading"
              >
                {selected && <ExamDetailPanel exam={selected} />}
              </ExamChoice>
            )}
          </section>

          {selected && extendsFrom && (
            <p className="rounded-lg bg-accent px-4 py-3 text-sm">
              You already have access to <strong>{selected.name}</strong> until{" "}
              <strong>{longDate(extendsFrom)}</strong> — this purchase extends
              it from that date.
            </p>
          )}

          <EcgDivider />

          {selected ? (
            <PayPalCheckoutButtons planId={plan.id} examId={selected.id} />
          ) : (
            // Deliberately not a disabled PayPal iframe: a greyed-out one
            // reads as broken, and not mounting also avoids loading the SDK
            // before the buyer has shown intent.
            <div className="space-y-2">
              <Button size="lg" className="w-full" disabled>
                Select an examination to continue
              </Button>
              <p
                role="status"
                className="text-center text-xs text-muted-foreground"
              >
                Pick the exam you are preparing for to unlock payment.
              </p>
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Secure payment via PayPal. Access starts immediately after payment.{" "}
            <Link href="/#pricing" className="underline underline-offset-2">
              Change plan
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
