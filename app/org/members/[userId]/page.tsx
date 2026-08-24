import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock } from "lucide-react";
import {
  getMemberReadinessDetail,
  getOrgDepartment,
  listOrgEntitledExams,
  requireOrgAdmin,
} from "@/lib/orgs";
import {
  BAND_ON_TRACK_MIN,
  CADENCE_TARGET_DAYS,
  COVERAGE_MIN_SUBJECT_ATTEMPTS,
  COVERAGE_WEAK_PCT,
} from "@/lib/orgs-core";
import { uuid } from "@/lib/validation";
import { accuracyTone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TrendSparkline } from "@/components/org/trend-sparkline";
import {
  ReadinessCell,
  ReasonChips,
} from "@/components/org/readiness-badges";

export const metadata: Metadata = { title: "Member readiness" };

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : undefined;
}

/** Hand-rolled Tailwind bar, the weak-areas visual language. */
function SignalBar({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | null;
  detail: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{detail}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        {value !== null && (
          <div
            className={cn("h-full rounded-full", accuracyTone(value))}
            style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * One member's readiness breakdown (SPEC §8 v2). Same privacy boundary as
 * the dashboard: aggregates and test scores only — never answers, notes or
 * bookmarks.
 */
export default async function MemberReadinessPage(
  props: PageProps<"/org/members/[userId]">
) {
  const session = await requireOrgAdmin();
  const { userId } = await props.params;
  const sp = await props.searchParams;

  const parsedId = uuid().safeParse(userId);
  if (!parsedId.success) notFound();

  const now = new Date();
  const exams = await listOrgEntitledExams(session.org, now);
  if (exams.length === 0) notFound();
  const requestedExam = one(sp.exam);
  const examId = exams.some((e) => e.id === requestedExam)
    ? requestedExam!
    : exams[0].id;
  const exam = exams.find((e) => e.id === examId)!;

  const detail = await getMemberReadinessDetail(
    session.org,
    parsedId.data,
    examId,
    now
  );
  if (!detail) notFound();

  const department = detail.member.department_id
    ? await getOrgDepartment(session.org.id, detail.member.department_id)
    : null;

  const { readiness } = detail;
  const weakest = [...detail.subjects]
    .filter((s) => s.questionCount > 0)
    .sort((a, b) => (a.accuracyPct ?? -1) - (b.accuracyPct ?? -1));
  const recentDays = detail.weeklyActivity
    .slice(-4)
    .reduce((sum, w) => sum + w.days, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/org?exam=${examId}`}>
            <ArrowLeft data-icon="inline-start" />
            Dashboard
          </Link>
        </Button>
        {exams.length > 1 && (
          <nav aria-label="Choose an examination" className="flex gap-2">
            {exams.map((e) => (
              <Link
                key={e.id}
                href={`/org/members/${detail.member.user_id}?exam=${e.id}`}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs",
                  e.id === examId
                    ? "border-primary bg-primary/5 font-medium"
                    : "border-border hover:bg-muted"
                )}
              >
                {e.name}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {/* Hero: who + where they stand */}
      <Card>
        <CardContent className="flex flex-wrap items-start gap-x-8 gap-y-4">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {detail.name ?? detail.email ?? "Member"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {detail.email}
              {department && ` · ${department.name}`}
              {` · joined ${longDate(detail.member.joined_at)}`}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <ReadinessCell readiness={readiness} />
              <ReasonChips reasons={readiness.reasons} />
            </div>
            {detail.sitting && (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarClock className="size-4" aria-hidden="true" />
                {detail.sitting.kind === "upcoming"
                  ? detail.sitting.daysRemaining === 0
                    ? `The ${exam.name} sitting is today.`
                    : `${detail.sitting.daysRemaining} days until the ${exam.name} sitting.`
                  : `The ${exam.name} sitting date has passed.`}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">8-week trend</p>
            <TrendSparkline series={readiness.weeklyAccuracy} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Signal breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>What feeds the score</CardTitle>
            <CardDescription>
              Recent accuracy (timed work weighted double), trend, coverage
              and cadence over the last 8 weeks — aggregates only, never
              individual answers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SignalBar
              label="Accuracy vs pass mark"
              value={readiness.accuracyPct}
              detail={
                readiness.accuracyPct !== null
                  ? `${readiness.accuracyPct}% vs ${session.org.pass_mark_pct}% mark`
                  : "No attempts yet"
              }
            />
            <SignalBar
              label="Trend"
              value={
                readiness.trendDeltaPct !== null
                  ? 50 + readiness.trendDeltaPct * 2.5
                  : null
              }
              detail={
                readiness.trendDeltaPct !== null
                  ? `${readiness.trendDeltaPct > 0 ? "+" : ""}${readiness.trendDeltaPct} pts vs prior 4 weeks`
                  : "Not enough history"
              }
            />
            <SignalBar
              label="Subject coverage"
              value={readiness.coveragePct}
              detail={
                readiness.coveragePct !== null
                  ? `${readiness.coveragePct}% of subjects covered`
                  : "No published subjects"
              }
            />
            <SignalBar
              label="Study cadence"
              value={Math.min(100, (recentDays / CADENCE_TARGET_DAYS) * 100)}
              detail={`${recentDays} active ${
                recentDays === 1 ? "day" : "days"
              } in the last 4 weeks`}
            />
            {detail.pacingSecPerQuestion !== null && (
              <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                Pacing: about {detail.pacingSecPerQuestion}s per question in
                timed work. Shown for context — pacing never moves the score.
              </p>
            )}
            {/* Adherence only (SPEC §17): the plan's contents are the
                member's own — the org sees whether it's being followed. */}
            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              Study plan:{" "}
              {detail.planAdherencePct !== null
                ? `${detail.planAdherencePct}% of weekly goals met over the last 4 weeks`
                : "no plan history for this exam"}
              {detail.hasActivePlan ? " · active this week" : ""}. Shown for
              context — the plan never moves the score.
            </p>
          </CardContent>
        </Card>

        {/* Per-subject accuracy — the §8-promised org-side view */}
        <Card>
          <CardHeader>
            <CardTitle>Accuracy by subject</CardTitle>
            <CardDescription>
              A subject counts as covered from{" "}
              {COVERAGE_MIN_SUBJECT_ATTEMPTS} attempts at{" "}
              {COVERAGE_WEAK_PCT}%+ accuracy.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {weakest.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This exam has no published subjects yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {weakest.map((subject) => (
                  <li key={subject.subjectId}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate">{subject.subjectName}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {subject.attempts > 0
                          ? `${subject.attempts} attempts · `
                          : ""}
                        <span className="font-semibold text-foreground">
                          {subject.accuracyPct !== null
                            ? `${Math.round(subject.accuracyPct)}%`
                            : "Not started"}
                        </span>
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                      {subject.accuracyPct !== null && (
                        <div
                          className={cn(
                            "h-full rounded-full",
                            accuracyTone(subject.accuracyPct)
                          )}
                          style={{ width: `${subject.accuracyPct}%` }}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Timed mock history */}
      <Card>
        <CardHeader>
          <CardTitle>Timed mock history</CardTitle>
          <CardDescription>
            Submitted exam-mode tests for {exam.name} — a recent one is
            required to reach the on-track band ({BAND_ON_TRACK_MIN}+).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {detail.mockHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No timed mocks yet — tutor practice alone caps the readiness
              score below on-track.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Answered</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.mockHistory.map((mock) => (
                  <TableRow key={mock.id}>
                    <TableCell className="text-muted-foreground">
                      {mock.submittedAt ? longDate(mock.submittedAt) : "—"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "font-semibold tabular-nums",
                        mock.score !== null &&
                          mock.score < session.org.pass_mark_pct &&
                          "text-destructive"
                      )}
                    >
                      {mock.score !== null ? `${Math.round(mock.score)}%` : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {mock.answeredQuestions ?? "—"}/{mock.totalQuestions}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
