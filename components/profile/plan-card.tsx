import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { Profile } from "@/lib/supabase/types";
import { ROLE_LABEL } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

/**
 * Full plan details for the profile page. The dashboard keeps its quieter
 * AccountPanel (CTA only near the limit); here the plans link is always
 * visible for trial users.
 */
export function PlanCard({ profile }: { profile: Profile }) {
  const isTrial = profile.role === "trial";
  const { trials_used, trials_limit } = profile;
  const remaining = Math.max(0, trials_limit - trials_used);

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-lg">Your plan</h2>
          <Badge variant={isTrial ? "secondary" : "default"}>
            {ROLE_LABEL[profile.role]}
          </Badge>
        </div>

        {isTrial ? (
          <>
            <div>
              <p className="flex items-baseline justify-between text-sm font-medium">
                Trial tests
                <span className="tabular-nums text-muted-foreground">
                  {trials_used}/{trials_limit}
                </span>
              </p>
              <Progress
                value={Math.min(
                  100,
                  (trials_used / Math.max(1, trials_limit)) * 100
                )}
                className="mt-2 h-1.5"
                aria-label={`${trials_used} of ${trials_limit} trial tests used`}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {remaining > 0
                  ? `${remaining} free ${remaining === 1 ? "test" : "tests"} remaining.`
                  : "You've used all your free tests."}
              </p>
            </div>
            <Button size="sm" className="w-full" asChild>
              <Link href="/#pricing">View plans</Link>
            </Button>
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="size-4 text-primary" aria-hidden />
            Full access to the question bank and mock exams.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
