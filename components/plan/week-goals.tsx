import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { goalTitle, type PlanGoal } from "@/lib/plan-core";
import type { GoalProgress, WeekProgress } from "@/lib/plan-core";
import type { PlanGoalsDoc } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StartGoalButton } from "@/components/plan/start-goal-button";

function goalDetail(goal: PlanGoal): string {
  switch (goal.type) {
    case "total_questions":
      return "Any practice counts — tutor sessions, mocks, your own tests.";
    case "focus_sessions":
      return goal.reason === "coverage_gap"
        ? `${goal.questionsPerSession} tutor questions — you haven't practised this subject much yet.`
        : `${goal.questionsPerSession} tutor questions — accuracy here is below your other subjects.`;
    case "mock":
      return goal.diagnostic
        ? `${goal.numQuestions} questions, ${goal.durationMin} min — sets your baseline so next week's plan fits you.`
        : `${goal.numQuestions} questions, ${goal.durationMin} min under exam conditions.`;
  }
}

/** This week's frozen goals with live progress and one-click starts. */
export function WeekGoals({
  planWeekId,
  doc,
  progress,
}: {
  planWeekId: string;
  doc: PlanGoalsDoc;
  progress: WeekProgress;
}) {
  const byId = new Map(progress.goals.map((g) => [g.goalId, g]));

  return (
    <Card>
      <CardContent className="divide-y divide-border">
        {doc.goals.map((goal) => {
          const p: GoalProgress | undefined = byId.get(goal.id);
          const met = p?.met ?? false;
          return (
            <div
              key={goal.id}
              className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {met ? (
                    <CheckCircle2
                      className="size-4 shrink-0 text-success"
                      aria-hidden="true"
                    />
                  ) : (
                    <Circle
                      className="size-4 shrink-0 text-muted-foreground/50"
                      aria-hidden="true"
                    />
                  )}
                  <span className={cn(met && "text-muted-foreground line-through")}>
                    {goalTitle(goal)}
                  </span>
                </p>
                <p className="mt-1 pl-6 text-xs text-muted-foreground">
                  {goalDetail(goal)}
                </p>
                {p && goal.type === "total_questions" && (
                  <div className="mt-2 flex items-center gap-2 pl-6">
                    <Progress
                      value={Math.min(100, (p.done / Math.max(1, p.target)) * 100)}
                      className="h-1.5 max-w-48"
                      aria-label={`${p.done} of ${p.target} questions answered`}
                    />
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {p.done}/{p.target}
                    </span>
                  </div>
                )}
                {p && goal.type === "focus_sessions" && (
                  <p className="mt-1 pl-6 text-xs tabular-nums text-muted-foreground">
                    {p.done}/{p.target} session{p.target === 1 ? "" : "s"} done
                  </p>
                )}
              </div>
              {goal.type === "total_questions" ? (
                !met && (
                  <Link
                    href="/tests/new"
                    className="shrink-0 text-sm font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Build a test
                  </Link>
                )
              ) : (
                <StartGoalButton
                  planWeekId={planWeekId}
                  goalId={goal.id}
                  label={met ? "Run again" : "Start"}
                  done={met}
                />
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
