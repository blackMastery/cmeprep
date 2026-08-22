import type { QuestionReportHistoryRow } from "@/lib/admin/question-reports";
import {
  REPORT_CATEGORY_LABELS,
  REPORT_RESOLUTION_LABELS,
} from "@/lib/question-reports-core";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const fmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * The editor's full report history for one question — open and resolved,
 * newest first. The reopen rule ("carry the last ruling forward") depends
 * on this memory, so nothing is ever hidden from it.
 */
export function QuestionReportHistory({
  open,
  rows,
  reportsHref,
}: {
  open: number;
  rows: QuestionReportHistoryRow[];
  reportsHref: string;
}) {
  if (rows.length === 0) return null;

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg">
            Reports
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {open} open · {rows.length - open} resolved
            </span>
          </h2>
          <a
            href={reportsHref}
            className="text-sm font-medium text-primary hover:underline"
          >
            Open the queue
          </a>
        </div>
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.reportId} className="flex flex-wrap items-start gap-2 py-2.5 text-sm">
              <span className="w-20 shrink-0 tabular-nums text-muted-foreground">
                {fmt.format(new Date(r.createdAt))}
              </span>
              <div className="min-w-0 flex-1">
                <p>
                  <span className="font-medium">{r.userName}</span>
                  {r.email && (
                    <span className="text-muted-foreground"> · {r.email}</span>
                  )}
                  {r.category ? (
                    <Badge variant="outline" className="ml-2">
                      {REPORT_CATEGORY_LABELS[r.category]}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="ml-2">
                      mid-test tap
                    </Badge>
                  )}
                </p>
                {r.note && <p className="text-muted-foreground">{r.note}</p>}
              </div>
              <div className="shrink-0 text-right text-xs">
                {r.resolution && r.resolvedAt ? (
                  <>
                    <Badge
                      variant={r.resolution === "no_change" ? "outline" : "secondary"}
                    >
                      {REPORT_RESOLUTION_LABELS[r.resolution]}
                    </Badge>
                    <p className="mt-1 text-muted-foreground">
                      {r.resolvedBy ?? "System"} · {fmt.format(new Date(r.resolvedAt))}
                    </p>
                    {r.resolutionNote && (
                      <p className="max-w-xs text-muted-foreground">{r.resolutionNote}</p>
                    )}
                  </>
                ) : (
                  <Badge variant="destructive">Open</Badge>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
