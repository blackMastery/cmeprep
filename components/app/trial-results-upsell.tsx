import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { Profile } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Post-test upgrade nudge for trial accounts. Shown on every results page
 * while the user is still on trial — conversion moment after they see their
 * score.
 */
export function TrialResultsUpsell({ profile }: { profile: Profile }) {
  if (profile.role !== "trial") return null;

  const remaining = Math.max(0, profile.trials_limit - profile.trials_used);

  return (
    <Card className="mt-8 border-primary/20 bg-accent/40 [--card-spacing:--spacing(5)]">
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <p className="font-display text-base font-semibold tracking-tight">
              {remaining > 0
                ? `${remaining} free ${remaining === 1 ? "test" : "tests"} left`
                : "You've used all your free tests"}
            </p>
            <p className="text-sm text-muted-foreground">
              Upgrade for unlimited mock exams, the full question bank, and
              detailed performance tracking.
            </p>
          </div>
        </div>
        <Button size="xl" className="w-full shrink-0 sm:w-auto" asChild>
          <Link href="/#pricing">View plans</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
