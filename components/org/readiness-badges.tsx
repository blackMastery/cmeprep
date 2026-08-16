import type { MemberReadiness, ReadinessBand, ReadinessReason } from "@/lib/orgs-core";
import { Badge } from "@/components/ui/badge";

/** Admin-facing labels. The member-facing card deliberately uses SOFTER
 * wording (components/dashboard/readiness-card.tsx) — "at risk" is a term
 * for program directors, never for the member themselves. */
export const BAND_LABEL: Record<ReadinessBand, string> = {
  on_track: "On track",
  borderline: "Borderline",
  at_risk: "At risk",
  insufficient_data: "Not enough data",
};

export const REASON_LABEL: Record<ReadinessReason, string> = {
  below_pass_mark: "Below pass mark",
  inactive: "Inactive",
  no_timed_practice: "No timed mocks",
  declining_trend: "Declining",
  low_coverage: "Low coverage",
  uneven_cadence: "Irregular study",
  insufficient_attempts: "Too few questions",
  joined_recently: "Just joined",
};

const BAND_VARIANT: Record<
  ReadinessBand,
  "default" | "secondary" | "destructive" | "outline"
> = {
  on_track: "default",
  borderline: "secondary",
  at_risk: "destructive",
  insufficient_data: "outline",
};

export function ReadinessBandBadge({ band }: { band: ReadinessBand }) {
  return <Badge variant={BAND_VARIANT[band]}>{BAND_LABEL[band]}</Badge>;
}

/** Score + band, the readiness cell everywhere admin-side. A null score
 * (insufficient data) never renders a number that looks authoritative. */
export function ReadinessCell({
  readiness,
}: {
  readiness: Pick<MemberReadiness, "band" | "score">;
}) {
  return (
    <div className="flex items-center gap-2">
      {readiness.score !== null && (
        <span className="font-semibold tabular-nums">{readiness.score}</span>
      )}
      <ReadinessBandBadge band={readiness.band} />
    </div>
  );
}

export function ReasonChips({ reasons }: { reasons: ReadinessReason[] }) {
  if (reasons.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {reasons.map((reason) => (
        <Badge key={reason} variant="outline" className="text-muted-foreground">
          {REASON_LABEL[reason]}
        </Badge>
      ))}
    </div>
  );
}
