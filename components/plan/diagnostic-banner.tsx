"use client";

import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import {
  dismissDiagnosticAction,
  type PlanActionState,
} from "@/app/(app)/plan/actions";
import { Button } from "@/components/ui/button";

/**
 * Cold-start explainer above the goal list: why the plan opens with a
 * diagnostic mock, and the way out for students who refuse timed pressure
 * early. Dismissing regenerates this week with generic targets.
 */
export function DiagnosticBanner({ examId }: { examId: string }) {
  const [state, formAction] = useActionState<PlanActionState, FormData>(
    dismissDiagnosticAction,
    null
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-teal/30 bg-teal/5 px-4 py-3">
      <p className="flex items-start gap-2 text-sm">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-teal-deep" aria-hidden="true" />
        <span>
          <span className="font-medium">Start with the diagnostic mock.</span>{" "}
          It sets your baseline so next week&apos;s plan can target your actual
          weak areas.
        </span>
      </p>
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="examId" value={examId} />
        <Button type="submit" size="sm" variant="ghost">
          Skip for now
        </Button>
        {state?.error && (
          <p className="text-xs text-destructive">{state.error}</p>
        )}
      </form>
    </div>
  );
}
