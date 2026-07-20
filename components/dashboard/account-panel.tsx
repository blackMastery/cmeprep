import Link from "next/link";
import type { Profile } from "@/lib/supabase/types";
import { ROLE_LABEL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function AccountPanel({ profile }: { profile: Profile }) {
  const isTrial = profile.role === "trial";
  const remaining = profile.trials_limit - profile.trials_used;
  const nearLimit = isTrial && remaining <= 1;

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <h2 className="font-display text-lg">Your account</h2>

        <dl className="space-y-2.5 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Account type</dt>
            <dd>
              <Badge variant={isTrial ? "secondary" : "default"}>
                {ROLE_LABEL[profile.role]}
              </Badge>
            </dd>
          </div>
          {isTrial && (
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Trials used</dt>
              <dd className="font-semibold tabular-nums">
                {profile.trials_used}/{profile.trials_limit}
              </dd>
            </div>
          )}
        </dl>

        {nearLimit && (
          <div className="space-y-3 rounded-xl bg-secondary px-4 py-3.5">
            <p className="text-sm text-secondary-foreground">
              {remaining > 0 ? (
                <>
                  You have{" "}
                  <strong className="font-semibold">
                    {remaining} free test
                  </strong>{" "}
                  left. Upgrade for unlimited mock exams and the full question
                  bank.
                </>
              ) : (
                <>
                  You&apos;ve used all your free tests. Upgrade to keep
                  practising.
                </>
              )}
            </p>
            <Button size="sm" className="w-full" asChild>
              <Link href="/#pricing">View plans</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
