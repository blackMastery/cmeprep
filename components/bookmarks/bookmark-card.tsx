"use client";

import { useActionState, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import {
  removeBookmark,
  type BookmarkFormState,
} from "@/app/(app)/bookmarks/actions";
import type { BookmarkRow } from "@/lib/bookmarks";
import { cn } from "@/lib/utils";
import { questionImageUrl } from "@/lib/storage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AnswerOption, type AnswerState } from "@/components/test/answer-option";
import { QuestionImage } from "@/components/test/question-image";
import { QuestionNoteEditor } from "@/components/question-note-editor";
import { ConfirmSubmit } from "@/components/confirm-dialog";

const LETTERS = "ABCDEFGH".split("");

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function BookmarkCard({ row }: { row: BookmarkRow }) {
  const [expanded, setExpanded] = useState(false);
  const [removeState, removeAction] = useActionState<
    BookmarkFormState,
    FormData
  >(removeBookmark, null);

  const excerpt =
    row.stem.length > 90 ? `${row.stem.slice(0, 90)}…` : row.stem;

  if (row.unavailable) {
    return (
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            This question is no longer available.
          </p>
          <RemoveButton
            questionId={row.questionId}
            excerpt="this question"
            action={removeAction}
            error={removeState?.error}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{row.subjectName}</Badge>
          <span className="text-xs text-muted-foreground">{row.topicName}</span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            Saved {dateFormatter.format(new Date(row.bookmarkedAt))}
          </span>
        </div>

        <p className="font-display leading-relaxed">
          {expanded ? row.stem : excerpt}
        </p>

        <p className="text-xs text-muted-foreground">
          {row.lastAttempt ? (
            <span className="inline-flex items-center gap-1.5">
              Last attempted{" "}
              {dateFormatter.format(new Date(row.lastAttempt.answeredAt))} —
              {row.lastAttempt.isCorrect ? (
                <span className="inline-flex items-center gap-1 font-medium text-success">
                  <Check className="size-3.5" strokeWidth={3} /> correct
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-medium text-destructive">
                  <X className="size-3.5" strokeWidth={3} /> incorrect
                </span>
              )}
            </span>
          ) : (
            "Not attempted yet — answer it in a test to unlock the answer here."
          )}
        </p>

        {expanded && row.detail && (
          <ExpandedDetail row={row} detail={row.detail} />
        )}

        <QuestionNoteEditor questionId={row.questionId} initialBody={row.note} />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          {row.detail ? (
            <Button
              type="button"
              variant="outline-muted"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              <ChevronDown
                data-icon="inline-start"
                className={cn("transition-transform", expanded && "rotate-180")}
              />
              {expanded ? "Hide answer" : "Show answer"}
            </Button>
          ) : (
            <span aria-hidden />
          )}
          <RemoveButton
            questionId={row.questionId}
            excerpt={excerpt}
            action={removeAction}
            error={removeState?.error}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ExpandedDetail({
  row,
  detail,
}: {
  row: BookmarkRow;
  detail: NonNullable<BookmarkRow["detail"]>;
}) {
  const selected = row.lastAttempt?.selectedOptionIds ?? [];

  return (
    <div className="space-y-4">
      {questionImageUrl(row.imagePath) && (
        <QuestionImage src={questionImageUrl(row.imagePath)!} />
      )}

      <div className="space-y-2.5">
        {detail.options.map((opt, i) => {
          const isSelected = selected.includes(opt.id);
          let state: AnswerState = "idle";
          if (isSelected && opt.isCorrect) state = "correct";
          else if (isSelected && !opt.isCorrect) state = "incorrect";
          else if (!isSelected && opt.isCorrect) state = "missed";

          return (
            <AnswerOption
              key={opt.id}
              id={opt.id}
              groupName={`bookmark-${row.questionId}`}
              label={opt.label}
              letter={LETTERS[i] ?? String(i + 1)}
              multi={row.type === "mcq_multi"}
              selected={isSelected}
              state={state}
              disabled
            />
          );
        })}
      </div>

      <div className="rounded-xl border-l-2 border-primary bg-secondary/60 px-4 py-3.5">
        <p className="mb-1 text-xs font-semibold tracking-wide text-primary uppercase">
          Explanation
        </p>
        <p className="text-sm leading-relaxed text-foreground/90">
          {detail.explanation}
        </p>
      </div>
    </div>
  );
}

function RemoveButton({
  questionId,
  excerpt,
  action,
  error,
}: {
  questionId: string;
  excerpt: string;
  action: (formData: FormData) => void;
  error?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <form action={action}>
        <input type="hidden" name="questionId" value={questionId} />
        <ConfirmSubmit
          title="Remove bookmark?"
          description={`"${excerpt}" will be removed from your bookmarks. Any note you made stays.`}
          confirmLabel="Remove"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
        >
          Remove
        </ConfirmSubmit>
      </form>
    </div>
  );
}
