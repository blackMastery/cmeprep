import Link from "next/link";
import { Lock } from "lucide-react";
import type { Profile } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EcgDivider } from "@/components/brand/ecg-line";

export function TrialLimitCard({ profile }: { profile: Profile }) {
  return (
    <Card className="[--card-spacing:--spacing(7)]">
      <CardContent className="space-y-5 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-accent text-primary">
          <Lock className="size-6" aria-hidden="true" />
        </span>

        <div className="space-y-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            You&apos;ve used all {profile.trials_limit} free tests
          </h1>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            Upgrade to unlock unlimited mock exams, the full question bank of
            1,000+ MCQs, and detailed performance tracking.
          </p>
        </div>

        <EcgDivider className="text-primary/30" />

        <div className="grid gap-3 sm:grid-cols-2">
          <PlanSummary
            name="1 month"
            price="$144"
            note="Full access, billed once"
          />
          <PlanSummary
            name="3 months"
            price="$216"
            note="Best value — save 50%"
            featured
          />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button size="lg" asChild>
            <Link href="/#pricing">View plans</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PlanSummary({
  name,
  price,
  note,
  featured = false,
}: {
  name: string;
  price: string;
  note: string;
  featured?: boolean;
}) {
  return (
    <div
      className={
        featured
          ? "rounded-xl bg-primary px-4 py-4 text-primary-foreground"
          : "rounded-xl border border-border px-4 py-4"
      }
    >
      <p className="text-sm font-medium">{name}</p>
      <p className="font-display text-2xl font-semibold">{price}</p>
      <p
        className={
          featured
            ? "text-xs text-primary-foreground/80"
            : "text-xs text-muted-foreground"
        }
      >
        {note}
      </p>
    </div>
  );
}
