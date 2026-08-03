import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, LayoutDashboard } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { finalizeIfExpired, getTestForUser } from "@/lib/tests";
import { getTestResults } from "@/lib/results";
import { accuracyTone, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EcgDivider } from "@/components/brand/ecg-line";
import { TrialResultsUpsell } from "@/components/app/trial-results-upsell";

export const metadata: Metadata = { title: "Results" };

export default async function ResultsPage(
  props: PageProps<"/tests/[id]/results">
) {
  const { id } = await props.params;
  const user = await requireUser();

  const existing = await getTestForUser(id, user.id);
  if (!existing) notFound();

  const test = await finalizeIfExpired(existing, user.id);
  if (test.status === "in_progress") {
    redirect(`/tests/${id}/take`);
  }

  const results = await getTestResults(test, user.id);
  const percentage = Math.round(Number(test.score ?? 0));
  const wrongCount = results.total - results.correct;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      {/* Hero score */}
      <div className="text-center">
        <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Your score
        </p>
        <p className="mt-2 font-display text-7xl font-semibold tracking-tight text-primary tabular-nums sm:text-8xl">
          {percentage}
          <span className="text-4xl sm:text-5xl">%</span>
        </p>
        <p className="mt-3 text-muted-foreground">
          <span className="font-semibold text-foreground">
            {results.correct}
          </span>{" "}
          of {results.total} correct
          {results.answered < results.total && (
            <> · {results.total - results.answered} left blank</>
          )}
          {" · "}
          {formatDuration(results.durationSec)} taken
        </p>
      </div>

      <EcgDivider className="my-8" />

      {/* Per-subject accuracy */}
      {results.breakdown.length > 0 && (
        <Card className="[--card-spacing:--spacing(6)]">
          <CardContent className="space-y-4">
            <h2 className="font-display text-lg">Accuracy by subject</h2>
            <ul className="space-y-3.5">
              {results.breakdown.map((subject) => (
                <li key={subject.subjectName}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{subject.subjectName}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {subject.correct}/{subject.total}
                      <span className="ml-2 font-semibold text-foreground">
                        {subject.accuracy}%
                      </span>
                    </span>
                  </div>
                  {/* Fill is toned by value on a blush track — a subject you
                      scored 30% on must not read as a confident green bar. */}
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width]",
                        accuracyTone(subject.accuracy)
                      )}
                      style={{ width: `${subject.accuracy}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <TrialResultsUpsell profile={user.profile} />

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        {wrongCount > 0 ? (
          <Button size="xl" className="flex-1" asChild>
            <Link href={`/tests/${id}/review?filter=wrong`}>
              Review {wrongCount} wrong{" "}
              {wrongCount === 1 ? "answer" : "answers"}
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        ) : (
          <Button size="xl" className="flex-1" asChild>
            <Link href={`/tests/${id}/review`}>
              Review all answers
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        )}
        <Button size="xl" variant="outline" className="flex-1" asChild>
          <Link href="/dashboard">
            <LayoutDashboard data-icon="inline-start" />
            Back to dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
