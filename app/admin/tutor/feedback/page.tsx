import type { Metadata } from "next";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { listTutorFeedback } from "@/lib/admin/tutor";
import { markTutorFeedbackHandled } from "@/app/admin/tutor/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Tutor feedback" };

/**
 * Student ratings on tutor answers. No regeneration — the signal exists so an
 * admin can tell the failure modes apart: a thumbs-down on an answer with no
 * chunks is a corpus gap, a thumbs-down on one WITH chunks means retrieval
 * pulled the wrong passages or MIN_SCORE is too low, and thumbs-up is the
 * evidence that the current tuning works.
 *
 * Ordered by listTutorFeedback: unhandled first, newest first. Negative
 * feedback is the part that needs working through, so it leads.
 */
export default async function TutorFeedbackPage() {
  const feedback = await listTutorFeedback();
  const down = feedback.filter((f) => f.rating === "down");
  const up = feedback.filter((f) => f.rating === "up");
  const openCount = down.filter((f) => f.handledAt === null).length;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <h1 className="font-display text-3xl font-semibold tracking-tight">
        Tutor feedback
      </h1>
      <p className="mt-1 mb-6 text-muted-foreground">
        {openCount === 0
          ? "No negative feedback waiting on review."
          : `${openCount} negative ${openCount === 1 ? "rating" : "ratings"} waiting on review.`}{" "}
        {up.length > 0 && `${up.length} positive.`}
      </p>

      {feedback.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-display text-lg">No feedback yet.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {[...down, ...up].map((row) => (
            <li key={row.id}>
              <Card className="[--card-spacing:--spacing(4)]">
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge
                      variant={row.rating === "down" ? "destructive" : "secondary"}
                    >
                      {row.rating === "down" ? (
                        <ThumbsDown className="size-3" aria-hidden="true" />
                      ) : (
                        <ThumbsUp className="size-3" aria-hidden="true" />
                      )}
                      {row.rating === "down" ? "Bad" : "Good"}
                    </Badge>
                    <Badge
                      variant={row.chunkIds.length === 0 ? "destructive" : "outline"}
                    >
                      {row.chunkIds.length === 0
                        ? "refusal"
                        : `${row.chunkIds.length} passages`}
                    </Badge>
                    <span className="font-medium">{row.userName}</span>
                    <span className="text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString("en-GB")}
                    </span>
                    {row.model && (
                      <span className="text-muted-foreground">{row.model}</span>
                    )}
                    {row.completionTokens !== null && (
                      <span className="tabular-nums text-muted-foreground">
                        {row.promptTokens ?? 0}+{row.completionTokens} tok
                      </span>
                    )}
                    <span className="ml-auto">
                      {row.handledAt ? (
                        <Badge variant="secondary">Handled</Badge>
                      ) : (
                        <form action={markTutorFeedbackHandled}>
                          <input type="hidden" name="id" value={row.id} />
                          <Button variant="outline-muted" size="sm">
                            Mark handled
                          </Button>
                        </form>
                      )}
                    </span>
                  </div>

                  {row.question && (
                    <p className="text-sm">
                      <span className="text-xs font-semibold tracking-wide uppercase">
                        Asked:{" "}
                      </span>
                      {row.question}
                    </p>
                  )}

                  <p className="max-h-64 overflow-y-auto text-sm whitespace-pre-wrap text-muted-foreground">
                    <span className="text-xs font-semibold tracking-wide uppercase">
                      Answered:{" "}
                    </span>
                    {row.answer}
                  </p>

                  {row.note && (
                    <p className="text-sm text-muted-foreground">
                      <span className="text-xs font-semibold tracking-wide uppercase">
                        They said:{" "}
                      </span>
                      {row.note}
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
