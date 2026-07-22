import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EcgDivider } from "@/components/brand/ecg-line";

export const metadata: Metadata = { title: "Payment complete" };

export default async function CheckoutSuccessPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan, current_period_end")
    .eq("user_id", user.id)
    .eq("status", "active")
    .gt("current_period_end", new Date().toISOString())
    .order("current_period_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  const until = sub
    ? new Date(sub.current_period_end).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12">
      <Card className="[--card-spacing:--spacing(7)]">
        <CardContent className="space-y-5 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-accent text-success">
            <CheckCircle2 className="size-7" aria-hidden="true" />
          </span>

          <div className="space-y-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              Payment complete
            </h1>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">
              {sub ? (
                <>
                  Your <strong>{sub.plan}</strong> access is active — unlimited
                  tests until <strong>{until}</strong>.
                </>
              ) : (
                <>
                  Thanks for your purchase. Your access is being activated —
                  refresh in a moment if it hasn&apos;t appeared yet.
                </>
              )}
            </p>
          </div>

          <EcgDivider className="text-primary/30" />

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button size="lg" asChild>
              <Link href="/tests/new">Start a test</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/dashboard">Go to dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
