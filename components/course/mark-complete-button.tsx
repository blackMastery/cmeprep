"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  markLessonComplete,
  type LessonActionState,
} from "@/app/(app)/cme/actions";
import { Button } from "@/components/ui/button";
import { useCredentialNameGate } from "@/components/course/credential-name-gate";

/** The explicit completion affordance for content lessons (spec §5). */
export function MarkCompleteButton({
  courseId,
  lessonId,
  completed,
  needsCredentialName,
}: {
  courseId: string;
  lessonId: string;
  completed: boolean;
  /** True until the learner has set profiles.credential_name. */
  needsCredentialName: boolean;
}) {
  const [state, action, pending] = useActionState<LessonActionState, FormData>(
    markLessonComplete,
    null
  );
  const gate = useCredentialNameGate(needsCredentialName);

  if (completed) {
    return (
      <p className="flex items-center gap-2 text-sm font-medium text-primary">
        <CheckCircle2 className="size-4" aria-hidden />
        Completed
      </p>
    );
  }

  return (
    <form action={action} {...gate.formProps} className="space-y-2">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="lessonId" value={lessonId} />
      <Button
        type="submit"
        onClick={gate.guard}
        disabled={pending}
        aria-busy={pending}
      >
        <CheckCircle2 data-icon="inline-start" />
        {pending ? "Saving…" : "Mark complete"}
      </Button>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
      {gate.dialog}
    </form>
  );
}
