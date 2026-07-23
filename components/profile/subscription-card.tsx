import Link from "next/link";
import type { Subscription } from "@/lib/supabase/types";
import { activePeriodEnd, displayStatus } from "@/lib/subscriptions-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const SUB_BADGE: Record<
  Subscription["status"],
  "default" | "outline" | "destructive"
> = {
  active: "default",
  expired: "outline",
  cancelled: "destructive",
};

/**
 * Read-only subscription view for students. Purchases are one-time PayPal
 * captures that stack, so there is nothing to cancel — access simply runs
 * until the latest active period end.
 */
export function SubscriptionCard({
  subscriptions,
}: {
  subscriptions: Subscription[];
}) {
  const now = new Date();
  const until = activePeriodEnd(subscriptions, now);
  const current =
    until === null
      ? null
      : (subscriptions.find((s) => s.current_period_end === until) ?? null);

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-lg">Subscription</h2>
          <Badge variant={until !== null ? "default" : "secondary"}>
            {until !== null ? "Active" : "None"}
          </Badge>
        </div>

        {current !== null ? (
          <div>
            <p className="text-sm font-medium">{current.plan}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Access until {dateFormatter.format(new Date(until!))}
            </p>
          </div>
        ) : subscriptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No subscriptions yet.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              No active subscription.
            </p>
            <Button variant="outline" size="sm" className="w-full" asChild>
              <Link href="/#pricing">View plans</Link>
            </Button>
          </>
        )}

        {subscriptions.length > 0 && (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              History
            </p>
            <ul className="space-y-2">
              {subscriptions.map((sub) => (
                <li
                  key={sub.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span className="font-medium">{sub.plan}</span>
                  <Badge variant={SUB_BADGE[displayStatus(sub, now)]}>
                    {displayStatus(sub, now)}
                  </Badge>
                  {sub.paypal_subscription_id && (
                    <Badge variant="outline">PayPal</Badge>
                  )}
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {dateFormatter.format(new Date(sub.created_at))} →{" "}
                    {dateFormatter.format(new Date(sub.current_period_end))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
