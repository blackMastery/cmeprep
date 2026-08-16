import Link from "next/link";
import { AlertTriangle, Clock, Inbox } from "lucide-react";
import type { OpsHealth } from "@/lib/analytics";
import { priceLabel } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Failure states that money depends on, rendered ONLY when non-empty — a
 * clean pipeline shows nothing rather than a row of green boxes nobody reads.
 * These are the conditions an admin will not notice by not looking.
 */
export function OpsAlerts({ ops }: { ops: OpsHealth }) {
  const alerts: {
    key: string;
    icon: typeof AlertTriangle;
    title: string;
    detail: string;
    href: string | null;
  }[] = [];

  if (ops.unclaimed.count > 0) {
    const amounts = ops.unclaimed.totals
      .map((t) => `${priceLabel(t.cents)}${t.currency === "USD" ? "" : ` ${t.currency}`}`)
      .join(", ");
    alerts.push({
      key: "unclaimed",
      icon: AlertTriangle,
      title: `${ops.unclaimed.count} payment${ops.unclaimed.count === 1 ? "" : "s"} captured without a grant`,
      detail: `${amounts} taken with no access given. The 15-minute sweep retries these; anything sitting here needs a human.`,
      href: "/admin/payments?unclaimed=1",
    });
  }

  if (ops.webhookBacklog.count > 0) {
    alerts.push({
      key: "backlog",
      icon: Inbox,
      title: `${ops.webhookBacklog.count} unprocessed PayPal webhook event${ops.webhookBacklog.count === 1 ? "" : "s"}`,
      detail:
        ops.webhookBacklog.quarantined > 0
          ? `${ops.webhookBacklog.quarantined} quarantined after repeated replays — these need manual handling.`
          : "The reconcile sweep replays these automatically; a growing number means the handler keeps failing.",
      href: null,
    });
  }

  if (ops.reconcile.stale) {
    alerts.push({
      key: "stale",
      icon: Clock,
      title: "Reconcile sweep has not reported in over 2 hours",
      detail:
        ops.reconcile.latest === null
          ? "No run has ever been recorded — check the pg_cron job and Vault secrets."
          : `Last run ${new Date(ops.reconcile.latest.ran_at).toLocaleString("en-GB")}. It should run every 15 minutes.`,
      href: null,
    });
  }

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-3" role="alert">
      {alerts.map(({ key, icon: Icon, title, detail, href }) => (
        <Card
          key={key}
          className="border-destructive/50 bg-destructive/5 [--card-spacing:--spacing(4)]"
        >
          <CardContent className="flex items-start gap-3">
            <Icon className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium">
                {href ? (
                  <Link href={href} className="hover:underline">
                    {title}
                  </Link>
                ) : (
                  title
                )}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
