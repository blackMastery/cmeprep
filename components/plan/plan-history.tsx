import type { PlanWeekView } from "@/lib/plan";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function weekLabel(weekStart: string): string {
  return new Date(`${weekStart}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Past plan weeks, newest first. Skipped weeks never generated rows, so a
 * date jump IS the gap — the honest record, no smoothing.
 */
export function PlanHistory({ history }: { history: PlanWeekView[] }) {
  if (history.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Past weeks</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {history.map((week) => (
            <li
              key={week.id}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="text-muted-foreground">
                Week of {weekLabel(week.weekStart)}
              </span>
              {week.progress ? (
                <span
                  className={cn(
                    "tabular-nums",
                    week.progress.metCount === week.progress.total
                      ? "font-medium text-success"
                      : week.progress.metCount === 0
                        ? "text-muted-foreground"
                        : "text-foreground"
                  )}
                >
                  {week.progress.metCount}/{week.progress.total} goals met
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  couldn&apos;t read this week&apos;s goals
                </span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
