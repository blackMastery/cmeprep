import { CalendarClock, Compass } from "lucide-react";
import type { OwnReadiness } from "@/lib/stats";
import type { ReadinessBand, ReadinessReason } from "@/lib/orgs-core";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { TrendSparkline } from "@/components/org/trend-sparkline";

/**
 * The member's own readiness — SOFT-framed by design (SPEC §8 v2): the same
 * score their programme sees, presented as guidance. The words "at risk"
 * never appear here, and nothing hints at the admin-side flag.
 */

const BAND_COPY: Record<
  Exclude<ReadinessBand, "insufficient_data">,
  { label: string; className: string }
> = {
  on_track: { label: "On track", className: "bg-success/10 text-success" },
  borderline: {
    label: "Building momentum",
    className: "bg-sun/20 text-foreground",
  },
  at_risk: { label: "Needs focus", className: "bg-destructive/10 text-destructive" },
};

function guidance(own: OwnReadiness): string[] {
  const lines: string[] = [];
  const seen = new Set<ReadinessReason>(own.readiness.reasons);
  if (seen.has("no_timed_practice")) {
    lines.push("Add a timed mock this week — untimed practice alone can't show exam form.");
  }
  if (seen.has("inactive")) {
    lines.push("Pick it back up — a few questions today restarts your momentum.");
  }
  if (seen.has("declining_trend")) {
    lines.push("Recent accuracy dipped — review your wrong answers before adding volume.");
  }
  if (seen.has("low_coverage") && own.focusSubject) {
    lines.push(`Broaden your coverage — ${own.focusSubject} is a good next subject.`);
  } else if (seen.has("low_coverage")) {
    lines.push("Broaden your coverage — several subjects are still untouched.");
  }
  if (seen.has("uneven_cadence")) {
    lines.push("A few questions most days beats one big session.");
  }
  if (seen.has("below_pass_mark")) {
    lines.push("Accuracy is the priority — slow down and review every miss.");
  }
  if (lines.length === 0) {
    lines.push("Keep doing what you're doing — steady practice, regular mocks.");
  }
  return lines;
}

export function ReadinessCard({ own }: { own: OwnReadiness }) {
  const { readiness } = own;

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg">Exam readiness</h2>
            <p className="text-xs text-muted-foreground">
              {own.examName} · set with {own.orgName}
            </p>
          </div>
          {readiness.band !== "insufficient_data" && (
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium",
                BAND_COPY[readiness.band].className
              )}
            >
              {BAND_COPY[readiness.band].label}
            </span>
          )}
        </div>

        {readiness.band === "insufficient_data" ? (
          <p className="text-sm text-muted-foreground">
            Not enough practice for a reading yet — answer about{" "}
            <span className="font-semibold text-foreground">
              {own.attemptsNeeded} more questions
            </span>{" "}
            on {own.examName} and your readiness will appear here.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <p className="font-display text-4xl font-semibold tabular-nums text-teal-deep">
                {readiness.score}
                <span className="text-base text-muted-foreground">/100</span>
              </p>
              <TrendSparkline series={readiness.weeklyAccuracy} />
            </div>
            <ul className="space-y-1.5">
              {guidance(own).map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-2 text-sm text-foreground/90"
                >
                  <Compass
                    className="mt-0.5 size-3.5 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  {line}
                </li>
              ))}
            </ul>
          </>
        )}

        {own.sitting && (
          <p className="flex items-center gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
            <CalendarClock className="size-3.5" aria-hidden="true" />
            {own.sitting.kind === "upcoming"
              ? own.sitting.daysRemaining === 0
                ? "Your sitting is today. You've got this."
                : `${own.sitting.daysRemaining} days until your sitting.`
              : "Your sitting date has passed."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
