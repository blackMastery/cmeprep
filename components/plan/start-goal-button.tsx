"use client";

import { useLaunchTest } from "@/components/use-launch-test";
import { Button } from "@/components/ui/button";

/**
 * One-click launch of a prescribed plan session. The server holds the whole
 * prescription (frozen week row) — this posts only the ids, like the
 * assignment StartButton, and drops the student straight into the runner.
 */
export function StartGoalButton({
  planWeekId,
  goalId,
  label,
  done = false,
}: {
  planWeekId: string;
  goalId: string;
  label: string;
  /** Met goals keep a quiet re-run affordance rather than a loud CTA. */
  done?: boolean;
}) {
  const { busy, error, launch, router } = useLaunchTest();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant={done ? "outline" : "default"}
        onClick={() =>
          launch(
            { planWeekId, goalId },
            {
              // A stale week can't be launched — pull the fresh plan in.
              onErrorCode: (code) => {
                if (code === "plan_week_ended") router.refresh();
              },
            }
          )
        }
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? "Starting…" : label}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
