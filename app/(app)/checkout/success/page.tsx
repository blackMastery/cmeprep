import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listExamCatalog } from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EcgDivider } from "@/components/brand/ecg-line";

export const metadata: Metadata = { title: "Payment complete" };

export default async function CheckoutSuccessPage() {
  const user = await requireUser();
  const supabase = await createClient();

  // Newest row, not the furthest-out one: after buying a second exam the
  // buyer needs confirmation of what they JUST bought, which may well end
  // sooner than access they already had.
  const [{ data: sub }, catalog] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("plan, current_period_end, exam_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .gt("current_period_end", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    listExamCatalog(),
  ]);

  const until = sub
    ? new Date(sub.current_period_end).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  // null on an all-access row (admin comp or a legacy grandfathered grant).
  const examName = sub?.exam_id
    ? (catalog.find((exam) => exam.id === sub.exam_id)?.name ?? null)
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
                  Your <strong>{sub.plan}</strong> access to{" "}
                  <strong>{examName ?? "every examination"}</strong> is active —
                  unlimited tests until <strong>{until}</strong>.
                </>
              ) : (
                <>
                  Thanks for your purchase. Your access is being activated —
                  refresh in a moment if it hasn&apos;t appeared yet.
                </>
              )}
            </p>
          </div>

          <EcgDivider />

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
