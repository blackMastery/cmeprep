import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { priceLabel } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { EcgDivider } from "@/components/brand/ecg-line";
import { PayPalCheckoutButtons } from "@/components/checkout/paypal-buttons";

export const metadata: Metadata = { title: "Checkout" };

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function CheckoutPage(
  props: PageProps<"/checkout/[planId]">
) {
  const { planId } = await props.params;
  const user = await requireUser();
  const supabase = await createClient();

  const { data: plan } = await supabase
    .from("plans")
    .select("*")
    .eq("id", planId)
    .maybeSingle();

  // Self-serve checkout is for active paid plans with a known duration;
  // anything else (free, retired, admin-granted) has no buy page.
  if (
    !plan ||
    !plan.is_active ||
    plan.price_cents <= 0 ||
    plan.duration_months === null
  ) {
    notFound();
  }

  // RLS: users can read their own subscriptions.
  const { data: activeSub } = await supabase
    .from("subscriptions")
    .select("current_period_end")
    .eq("user_id", user.id)
    .eq("status", "active")
    .gt("current_period_end", new Date().toISOString())
    .order("current_period_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8 sm:py-12">
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
                    className="mt-0.5 size-4 shrink-0 text-success"
                    strokeWidth={3}
                    aria-hidden="true"
                  />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          )}

          {activeSub && (
            <p className="rounded-lg bg-accent px-4 py-3 text-sm">
              You already have access until{" "}
              <strong>{longDate(activeSub.current_period_end)}</strong> — this
              purchase extends it from that date.
            </p>
          )}

          <EcgDivider className="text-primary/30" />

          <PayPalCheckoutButtons planId={plan.id} />

          <p className="text-center text-xs text-muted-foreground">
            Secure payment via PayPal. Access starts immediately after
            payment.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
