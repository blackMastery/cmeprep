"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  deleteQuestion,
  saveQuestion,
} from "@/app/admin/courses/actions";
import type { AdminState } from "@/app/admin/subjects/actions";
import type { BuilderQuestion } from "@/lib/admin/courses";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormMessage } from "@/components/auth/form-parts";
import {
  AdminSubmit,
  AdminTextarea,
} from "@/components/admin/form-parts";
import { ConfirmSubmit } from "@/components/confirm-dialog";
import { Markdown } from "@/components/markdown";

/**
 * Question management for one quiz lesson. Each question is its own form
 * (forms can't nest inside the lesson form), option rows travel as one JSON
 * blob like the exam question editor.
 */
export function CourseQuizEditor({
  lessonId,
  questions,
}: {
  lessonId: string;
  questions: BuilderQuestion[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold">
        Questions{" "}
        <span className="font-normal text-muted-foreground">
          ({questions.length})
        </span>
      </h4>

      {questions.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">
          No questions yet — the quiz can&apos;t be passed (or published)
          without at least one.
        </p>
      )}

      <ol className="space-y-3">
        {questions.map((question, index) => (
          <li key={`${question.id}-${question.updated_at ?? ""}`}>
            <QuestionForm
              lessonId={lessonId}
              question={question}
              index={index}
            />
          </li>
        ))}
      </ol>

      {adding ? (
        <QuestionForm
          lessonId={lessonId}
          question={null}
          index={questions.length}
          onDone={() => setAdding(false)}
        />
      ) : (
        <Button
          type="button"
          variant="outline-muted"
          size="sm"
          onClick={() => setAdding(true)}
        >
          <Plus data-icon="inline-start" />
          Add question
        </Button>
      )}
    </div>
  );
}

type OptionDraft = { id?: string; label: string; isCorrect: boolean };

const EMPTY_OPTIONS: OptionDraft[] = [
  { label: "", isCorrect: true },
  { label: "", isCorrect: false },
];

function QuestionForm({
  lessonId,
  question,
  index,
  onDone,
}: {
  lessonId: string;
  question: BuilderQuestion | null;
  index: number;
  onDone?: () => void;
}) {
  const [saveState, saveAction] = useActionState<AdminState, FormData>(
    async (prev, fd) => {
      const result = await saveQuestion(prev, fd);
      if (result?.success) onDone?.();
      return result;
    },
    null
  );
  const [deleteState, deleteAction] = useActionState<AdminState, FormData>(
    deleteQuestion,
    null
  );
  const [expanded, setExpanded] = useState(question === null);
  const [options, setOptions] = useState<OptionDraft[]>(
    question
      ? question.options.map((o) => ({
          id: o.id,
          label: o.label,
          isCorrect: o.is_correct,
        }))
      : EMPTY_OPTIONS
  );

  if (!expanded && question) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5">
        <div className="min-w-0 text-sm">
          <span className="mr-2 text-muted-foreground">{index + 1}.</span>
          <Markdown className="inline-block align-top [&_p]:m-0">
            {question.prompt_md}
          </Markdown>
          <p className="mt-1 text-xs text-muted-foreground">
            {question.options.length} options
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setExpanded(true)}
          >
            Edit
          </Button>
          <form action={deleteAction}>
            <input type="hidden" name="id" value={question.id} />
            <ConfirmSubmit
              title="Delete this question?"
              confirmLabel="Delete question"
              description="Learners' past attempts keep their recorded scores; the question just stops being asked."
              triggerLabel="Delete question"
            >
              <Trash2 aria-hidden />
            </ConfirmSubmit>
          </form>
        </div>
      </div>
    );
  }

  return (
    <form
      action={saveAction}
      className="space-y-3 rounded-lg border bg-muted/30 p-3"
    >
      <input type="hidden" name="lessonId" value={lessonId} />
      {question && <input type="hidden" name="questionId" value={question.id} />}
      <input type="hidden" name="options" value={JSON.stringify(options)} />

      <FormMessage error={saveState?.error ?? deleteState?.error} />

      <AdminTextarea
        label={`Question ${index + 1} (markdown)`}
        name="promptMd"
        rows={3}
        defaultValue={question?.prompt_md ?? ""}
        required
      />

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          Options — pick the one correct answer
        </legend>
        {options.map((option, i) => (
          <div key={option.id ?? `new-${i}`} className="flex items-center gap-2">
            <input
              type="radio"
              name={`correct-${question?.id ?? "new"}`}
              aria-label={`Option ${i + 1} is correct`}
              checked={option.isCorrect}
              onChange={() =>
                setOptions((prev) =>
                  prev.map((o, j) => ({ ...o, isCorrect: j === i }))
                )
              }
              className="size-4 accent-primary"
            />
            <Input
              value={option.label}
              aria-label={`Option ${i + 1} text`}
              placeholder={`Option ${i + 1}`}
              className="h-9"
              onChange={(e) =>
                setOptions((prev) =>
                  prev.map((o, j) =>
                    j === i ? { ...o, label: e.target.value } : o
                  )
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove option ${i + 1}`}
              disabled={options.length <= 2}
              onClick={() =>
                setOptions((prev) => {
                  const next = prev.filter((_, j) => j !== i);
                  // Never leave the set with no correct pick.
                  return next.some((o) => o.isCorrect)
                    ? next
                    : next.map((o, j) => ({ ...o, isCorrect: j === 0 }));
                })
              }
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={options.length >= 8}
          onClick={() =>
            setOptions((prev) => [...prev, { label: "", isCorrect: false }])
          }
        >
          <Plus data-icon="inline-start" />
          Add option
        </Button>
      </fieldset>

      <AdminTextarea
        label="Explanation (markdown, shown after submitting)"
        name="explanationMd"
        rows={2}
        defaultValue={question?.explanation_md ?? ""}
      />

      <div className="flex gap-2">
        <AdminSubmit size="sm">Save question</AdminSubmit>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setExpanded(false);
            onDone?.();
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
