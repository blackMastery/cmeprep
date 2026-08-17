import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listGradeReports } from "@/lib/admin/osce";
import { markReportHandled } from "@/app/admin/osce/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "OSCE grade reports" };

/**
 * Student-flagged AI grades. There is no regrade — the signal exists so an
 * admin can spot a bad model answer (fix it on the question page) or a judge
 * failure pattern (check the grading log).
 */
export default async function OsceReportsPage() {
  const reports = await listGradeReports();
  const open = reports.filter((r) => r.handledAt === null);
  const handled = reports.filter((r) => r.handledAt !== null);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/osce">
            <ArrowLeft data-icon="inline-start" />
            Grading log
          </Link>
        </Button>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Grade reports
        </h1>
      </div>
      <p className="mb-6 text-muted-foreground">
        {open.length === 0
          ? "Nothing waiting on review."
          : `${open.length} waiting on review.`}{" "}
        Flagged by students who think the AI graded them wrongly — usually a
        model answer worth improving.
      </p>

      {reports.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-display text-lg">No reports yet.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {[...open, ...handled].map((report) => (
            <li key={report.id}>
              <Card className="[--card-spacing:--spacing(4)]">
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {report.verdict && (
                      <Badge
                        variant={
                          report.verdict === "correct"
                            ? "default"
                            : "destructive"
                        }
                      >
                        graded {report.verdict}
                      </Badge>
                    )}
                    <span className="font-medium">{report.userName}</span>
                    <span className="text-muted-foreground">
                      {new Date(report.createdAt).toLocaleString("en-GB")}
                    </span>
                    <span className="ml-auto">
                      {report.handledAt ? (
                        <Badge variant="secondary">Handled</Badge>
                      ) : (
                        <form action={markReportHandled}>
                          <input type="hidden" name="id" value={report.id} />
                          <Button variant="outline-muted" size="sm">
                            Mark handled
                          </Button>
                        </form>
                      )}
                    </span>
                  </div>

                  <p className="text-sm">
                    <Link
                      href={`/admin/questions/${report.questionId}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {report.questionStem || "View question"}
                    </Link>
                  </p>

                  {report.answerText && (
                    <p className="text-sm text-muted-foreground">
                      <span className="text-xs font-semibold tracking-wide uppercase">
                        Their answer:{" "}
                      </span>
                      {report.answerText}
                    </p>
                  )}
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
