import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, LayoutDashboard } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { finalizeIfExpired, getTestForUser } from "@/lib/tests";
import { getTestResults } from "@/lib/results";
import { getExamAccess } from "@/lib/entitlements";
import { openReportsFor } from "@/lib/question-reports";
import { needsElaboration } from "@/lib/question-reports-core";
import { accuracyTone, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EcgDivider } from "@/components/brand/ecg-line";
import { TrialResultsUpsell } from "@/components/app/trial-results-upsell";
import {
  ReportElaboration,
  type ElaborationItem,
} from "@/components/test/report-elaboration";

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

  // Same rule as the new-test wall (SPEC §3): a member whose org covers the
  // bank is not metered, so "2 free tests left — upgrade for unlimited mock
  // exams" was both untrue and an upsell for access they already have.
  const [access, reports] = await Promise.all([
    getExamAccess(user),
    // Bare reports tapped during THIS test get a category + note here,
    // skippable. OSCE has its own grade reports.
    test.mode === "osce"
      ? Promise.resolve([])
      : openReportsFor(
          user.id,
          results.questions.map((q) => q.questionId)
        ),
  ]);
  const bare = new Set(
    reports.filter((r) => needsElaboration(r, test.id)).map((r) => r.questionId)
  );
  const toElaborate: ElaborationItem[] = results.questions
    .filter((q) => bare.has(q.questionId) && !q.withheld)
    .map((q) => ({ questionId: q.questionId, position: q.position, stem: q.stem }));

  // Tutor and OSCE share the untimed correct/answered contract.
  const tutor = test.mode !== "exam";
  const osce = test.mode === "osce";
  const percentage = Math.round(Number(test.score ?? 0));
  // Tutor/OSCE score is correct/answered, so "wrong" must use the same base —
  // skipped questions were never graded.
  const wrongCount = tutor
    ? results.answered - results.correct
    : results.total - results.correct;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      {/* Hero score */}
      <div className="text-center">
        <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          {osce ? "OSCE session score" : tutor ? "Tutor session score" : "Your score"}
        </p>
        <p className="mt-2 font-display text-7xl font-semibold tracking-tight text-primary tabular-nums sm:text-8xl">
          {percentage}
          <span className="text-4xl sm:text-5xl">%</span>
        </p>
        {tutor ? (
          // Untimed and blanks-don't-count: completion replaces duration.
          <p className="mt-3 text-muted-foreground">
            <span className="font-semibold text-foreground">
              {results.correct}
            </span>{" "}
            of {results.answered} answered correct
            {" · "}
            {results.answered} of {results.total}{" "}
            {osce ? "stations graded" : "questions checked"}
            {results.answered < results.total && (
              <> · {results.total - results.answered} skipped</>
            )}
          </p>
        ) : (
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
        )}
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

      <ReportElaboration testId={id} items={toElaborate} />

      {!access.org && <TrialResultsUpsell profile={user.profile} />}

      {/* Tutor sessions already showed every explanation inline, so the
          dashboard is the primary next step and review the secondary one. */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        {tutor && (
          <Button size="xl" className="flex-1" asChild>
            <Link href="/dashboard">
              <LayoutDashboard data-icon="inline-start" />
              Back to dashboard
            </Link>
          </Button>
        )}
        {wrongCount > 0 ? (
          <Button
            size="xl"
            variant={tutor ? "outline" : "default"}
            className="flex-1"
            asChild
          >
            <Link href={`/tests/${id}/review?filter=wrong`}>
              Review {wrongCount} wrong{" "}
              {wrongCount === 1 ? "answer" : "answers"}
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        ) : (
          <Button
            size="xl"
            variant={tutor ? "outline" : "default"}
            className="flex-1"
            asChild
          >
            <Link href={`/tests/${id}/review`}>
              Review all answers
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        )}
        {!tutor && (
          <Button size="xl" variant="outline" className="flex-1" asChild>
            <Link href="/dashboard">
              <LayoutDashboard data-icon="inline-start" />
              Back to dashboard
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
