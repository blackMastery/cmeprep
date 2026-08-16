import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Hourglass } from "lucide-react";
import { hasTrialsRemaining, requireUser } from "@/lib/auth";
import { addDays } from "@/lib/orgs-core";
import {
  getPlanOverview,
  listPlanExams,
  resolvePrimaryPlanExam,
} from "@/lib/plan";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { WeekGoals } from "@/components/plan/week-goals";
import { PlanSettings } from "@/components/plan/plan-settings";
import { PlanHistory } from "@/components/plan/plan-history";
import { DiagnosticBanner } from "@/components/plan/diagnostic-banner";

export const metadata: Metadata = { title: "Study plan" };

function weekRange(weekStart: string): string {
  const fmt = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  return `${fmt(weekStart)} – ${fmt(addDays(weekStart, 6))}`;
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ exam?: string }>;
}) {
  const user = await requireUser();
  const { access, exams } = await listPlanExams(user);

  // Access loss IS this state: rows are retained, the surface disappears.
  if (exams.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Study plan
        </h1>
        <p className="mt-3 max-w-prose text-muted-foreground">
          Your study plan builds itself around an examination you have access
          to — weekly goals that adapt to your results. Subscribe to an exam
          (or renew a lapsed subscription) and your plan picks up right where
          it left off.
        </p>
        <Button className="mt-6" asChild>
          <Link href="/checkout">See plans</Link>
        </Button>
      </div>
    );
  }

  const { exam: requested } = await searchParams;
  let examId = exams.some((e) => e.id === requested) ? requested! : null;
  if (examId === null) {
    const { primaryId } = await resolvePrimaryPlanExam(user, exams);
    examId = primaryId ?? exams[0].id;
  }
  const exam = exams.find((e) => e.id === examId)!;

  const overview = await getPlanOverview(user, examId);
  const { current, settings, sitting, history } = overview;
  const hasDiagnostic = current.doc.goals.some(
    (g) => g.type === "mock" && g.diagnostic
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Study plan
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-muted-foreground">
          <span>{exam.name}</span>
          {sitting.framing && (
            <span className="flex items-center gap-1.5 text-sm">
              <CalendarClock className="size-3.5" aria-hidden="true" />
              {sitting.framing.kind === "upcoming"
                ? sitting.framing.daysRemaining === 0
                  ? "Your exam is today"
                  : `Exam in ${sitting.framing.daysRemaining} days`
                : "Your sitting date has passed"}
            </span>
          )}
        </p>
      </header>

      {exams.length > 1 && (
        <nav className="mb-6 flex flex-wrap gap-2" aria-label="Examination">
          {exams.map((e) => (
            <Link
              key={e.id}
              href={`/plan?exam=${e.id}`}
              aria-current={e.id === examId ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                e.id === examId
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {e.name}
            </Link>
          ))}
        </nav>
      )}

      <div className="space-y-6">
        {/* Trial affordance: prescribed sessions bill like any test (SPEC
            §16 precedent), so say so BEFORE a Start burns a credit — the
            wizard renders locks, the plan must not be the surprise path. */}
        {user.profile.role === "trial" && access.org === null && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sun/60 bg-sun/10 px-4 py-3 text-sm">
            <p className="flex items-start gap-2">
              <Hourglass
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              {hasTrialsRemaining(user.profile) ? (
                <span>
                  Free trial:{" "}
                  <span className="font-medium">
                    {user.profile.trials_limit - user.profile.trials_used} of{" "}
                    {user.profile.trials_limit}
                  </span>{" "}
                  practice tests left — each session you start uses one.
                </span>
              ) : (
                <span>
                  You&apos;ve used all your free practice tests — upgrade to
                  keep following your plan.
                </span>
              )}
            </p>
            <Button size="sm" variant="outline" asChild>
              <Link href="/checkout">See plans</Link>
            </Button>
          </div>
        )}

        {hasDiagnostic && <DiagnosticBanner examId={examId} />}

        <section>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="font-display text-lg">This week&apos;s goals</h2>
            <p className="text-sm text-muted-foreground">
              {weekRange(current.weekStart)} ·{" "}
              <span className="font-medium tabular-nums text-foreground">
                {current.progress.metCount}/{current.progress.total} met
              </span>
            </p>
          </div>
          <WeekGoals
            planWeekId={current.id}
            doc={current.doc}
            progress={current.progress}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Goals are set each Monday from your recent results — weak subjects
            get focus sessions, and anything you practise counts, wherever you
            start it from.
          </p>
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <PlanSettings
            examId={examId}
            intensity={settings.intensity}
            personalSittingOn={settings.sittingOn}
            orgSittingOn={
              sitting.source === "org" ? sitting.sittingOn : null
            }
          />
          <PlanHistory history={history} />
        </div>
      </div>
    </div>
  );
}
