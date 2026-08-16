import Link from "next/link";
import { ListTodo } from "lucide-react";
import type { PlanCardData } from "@/lib/plan";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

/**
 * Compact study-plan summary for the primary exam. Strictly read-only:
 * when this week's plan hasn't been generated yet the card offers the link —
 * generation happens on /plan, never from a dashboard render.
 */
export function PlanCard({ data }: { data: PlanCardData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ListTodo className="size-4 text-primary" aria-hidden="true" />
          Study plan
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {data.examName}
          {data.daysToExam !== null && (
            <>
              {" · "}
              {data.daysToExam === 0
                ? "exam today"
                : `exam in ${data.daysToExam} days`}
            </>
          )}
        </p>

        {data.progress ? (
          <>
            <div className="flex items-center gap-3">
              <Progress
                value={
                  (data.progress.metCount / Math.max(1, data.progress.total)) *
                  100
                }
                className="h-2"
                aria-label={`${data.progress.metCount} of ${data.progress.total} weekly goals met`}
              />
              <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                {data.progress.metCount}/{data.progress.total}
              </span>
            </div>
            {data.nextGoalLabel && (
              <p className="text-sm">
                Next up:{" "}
                <span className="font-medium">{data.nextGoalLabel}</span>
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Your goals for this week are ready to be drawn up.
          </p>
        )}

        <Button variant="outline" size="sm" className="w-full" asChild>
          <Link href="/plan">
            {data.progress ? "Open study plan" : "See this week's plan"}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
