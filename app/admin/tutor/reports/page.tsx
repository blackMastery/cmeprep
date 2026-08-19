import type { Metadata } from "next";
import { listTutorReports } from "@/lib/admin/tutor";
import { markTutorReportHandled } from "@/app/admin/tutor/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Tutor answer reports" };

/**
 * Student-flagged tutor answers. No regeneration — the signal exists so an
 * admin can tell the two failure modes apart: an answer with no chunks was a
 * refusal (the corpus has a gap), and an answer with chunks that is still
 * wrong means retrieval pulled the wrong passages or MIN_SCORE is too low.
 */
export default async function TutorReportsPage() {
  const reports = await listTutorReports();
  const open = reports.filter((r) => r.handledAt === null);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <h1 className="font-display text-3xl font-semibold tracking-tight">
        Tutor answer reports
      </h1>
      <p className="mt-1 mb-6 text-muted-foreground">
        {open.length === 0
          ? "Nothing waiting on review."
          : `${open.length} waiting on review.`}{" "}
        Flagged by students who think the tutor answered badly.
      </p>

      {reports.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-display text-lg">No reports yet.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {reports.map((report) => (
            <li key={report.id}>
              <Card className="[--card-spacing:--spacing(4)]">
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge
                      variant={
                        report.chunkIds.length === 0 ? "destructive" : "secondary"
                      }
                    >
                      {report.chunkIds.length === 0
                        ? "refusal"
                        : `${report.chunkIds.length} passages`}
                    </Badge>
                    <span className="font-medium">{report.userName}</span>
                    <span className="text-muted-foreground">
                      {new Date(report.createdAt).toLocaleString("en-GB")}
                    </span>
                    {report.model && (
                      <span className="text-muted-foreground">
                        {report.model}
                      </span>
                    )}
                    {report.completionTokens !== null && (
                      <span className="tabular-nums text-muted-foreground">
                        {report.promptTokens ?? 0}+{report.completionTokens} tok
                      </span>
                    )}
                    <span className="ml-auto">
                      {report.handledAt ? (
                        <Badge variant="secondary">Handled</Badge>
                      ) : (
                        <form action={markTutorReportHandled}>
                          <input type="hidden" name="id" value={report.id} />
                          <Button variant="outline-muted" size="sm">
                            Mark handled
                          </Button>
                        </form>
                      )}
                    </span>
                  </div>

                  {report.question && (
                    <p className="text-sm">
                      <span className="text-xs font-semibold tracking-wide uppercase">
                        Asked:{" "}
                      </span>
                      {report.question}
                    </p>
                  )}

                  <p className="max-h-64 overflow-y-auto text-sm whitespace-pre-wrap text-muted-foreground">
                    <span className="text-xs font-semibold tracking-wide uppercase">
                      Answered:{" "}
                    </span>
                    {report.answer}
                  </p>

                  {report.note && (
                    <p className="text-sm text-muted-foreground">
                      <span className="text-xs font-semibold tracking-wide uppercase">
                        Note:{" "}
                      </span>
                      {report.note}
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
