"use client";

import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import type { ReviewQuestion } from "@/lib/results";
import { cn } from "@/lib/utils";
import { questionImageUrl } from "@/lib/storage";
import { QuestionImage } from "@/components/test/question-image";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AnswerOption, type AnswerState } from "@/components/test/answer-option";
import { ExplanationStrip } from "@/components/test/explanation-strip";
import { BookmarkToggle } from "@/components/bookmark-toggle";
import { QuestionNoteEditor } from "@/components/question-note-editor";

const LETTERS = "ABCDEFGH".split("");

export function ReviewList({
  questions,
  initialWrongOnly,
  initialBookmarkedIds = [],
  notesByQuestion = {},
  testId,
}: {
  questions: ReviewQuestion[];
  initialWrongOnly: boolean;
  initialBookmarkedIds?: string[];
  notesByQuestion?: Record<string, string>;
  /** Enables "Report this grade" on OSCE stations (posts to this test). */
  testId?: string;
}) {
  const [wrongOnly, setWrongOnly] = useState(initialWrongOnly);

  const visible = useMemo(
    () => (wrongOnly ? questions.filter((q) => !q.isCorrect) : questions),
    [questions, wrongOnly]
  );

  const wrongCount = questions.filter((q) => !q.isCorrect).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <FilterChip
          label={`All (${questions.length})`}
          active={!wrongOnly}
          onClick={() => setWrongOnly(false)}
        />
        <FilterChip
          label={`Wrong only (${wrongCount})`}
          active={wrongOnly}
          onClick={() => setWrongOnly(true)}
        />
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-display text-lg">Nothing to review here.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              You answered every question correctly.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ol className="space-y-6">
          {visible.map((q) => (
            <li key={q.questionId}>
              <ReviewCard
                question={q}
                initialBookmarked={initialBookmarkedIds.includes(q.questionId)}
                note={notesByQuestion[q.questionId] ?? null}
                testId={testId}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ReviewCard({
  question,
  initialBookmarked,
  note,
  testId,
}: {
  question: ReviewQuestion;
  initialBookmarked: boolean;
  note: string | null;
  testId?: string;
}) {
  // Private-bank content after leaving the org: the score survives, the
  // organisation's material does not (SPEC §4). Render the gap, never a 404.
  if (question.withheld) {
    return (
      <Card className="[--card-spacing:--spacing(6)]">
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium tabular-nums text-muted-foreground">
              Q{question.position + 1}
            </span>
            <Badge variant="secondary">{question.subjectName}</Badge>
            <span
              className={cn(
                "ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                question.isCorrect
                  ? "bg-success/10 text-success"
                  : "bg-destructive/10 text-destructive"
              )}
            >
              {question.isCorrect ? (
                <Check className="size-3.5" strokeWidth={3} />
              ) : (
                <X className="size-3.5" strokeWidth={3} />
              )}
              {question.isCorrect
                ? "Correct"
                : question.answered
                  ? "Incorrect"
                  : "Not answered"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            This question belongs to an organisation&apos;s private bank and
            is no longer available to review. Your result above still counts.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium tabular-nums text-muted-foreground">
            Q{question.position + 1}
          </span>
          <Badge variant="secondary">{question.subjectName}</Badge>
          <span
            className={cn(
              "ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              question.isCorrect
                ? "bg-success/10 text-success"
                : "bg-destructive/10 text-destructive"
            )}
          >
            {question.isCorrect ? (
              <Check className="size-3.5" strokeWidth={3} />
            ) : (
              <X className="size-3.5" strokeWidth={3} />
            )}
            {question.isCorrect
              ? "Correct"
              : question.answered
                ? "Incorrect"
                : "Not answered"}
          </span>
          <BookmarkToggle
            questionId={question.questionId}
            initialBookmarked={initialBookmarked}
          />
        </div>

        <p className="font-display text-lg leading-relaxed">{question.stem}</p>

        {questionImageUrl(question.imagePath) && (
          <QuestionImage src={questionImageUrl(question.imagePath)!} />
        )}

        {question.type === "osce" ? (
          <div className="space-y-3">
            {question.answered && (
              <div className="rounded-xl border border-border bg-card px-4 py-3.5">
                <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Your answer
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                  {question.answerText ?? ""}
                </p>
              </div>
            )}
            {question.modelAnswer && (
              <div className="rounded-xl border-l-2 border-teal bg-teal/5 px-4 py-3.5">
                <p className="mb-1 text-xs font-semibold tracking-wide text-teal uppercase">
                  Model answer
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                  {question.modelAnswer}
                </p>
              </div>
            )}
            {question.answered && testId && (
              <ReportGradeButton
                testId={testId}
                questionId={question.questionId}
              />
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            {question.options.map((opt, i) => {
              const selected = question.selectedOptionIds.includes(opt.id);
              let state: AnswerState = "idle";
              if (selected && opt.isCorrect) state = "correct";
              else if (selected && !opt.isCorrect) state = "incorrect";
              else if (!selected && opt.isCorrect) state = "missed";

              return (
                <AnswerOption
                  key={opt.id}
                  id={opt.id}
                  groupName={`review-${question.questionId}`}
                  label={opt.label}
                  letter={LETTERS[i] ?? String(i + 1)}
                  multi={question.type === "mcq_multi"}
                  selected={selected}
                  state={state}
                  disabled
                />
              );
            })}
          </div>
        )}

        <ExplanationStrip explanation={question.explanation} />

        <QuestionNoteEditor
          questionId={question.questionId}
          initialBody={note}
        />
      </CardContent>
    </Card>
  );
}

/** "This AI grade looks wrong" — pure triage signal; duplicates are answered
 * as success server-side, so optimistic state is safe. */
function ReportGradeButton({
  testId,
  questionId,
}: {
  testId: string;
  questionId: string;
}) {
  const [reported, setReported] = useState(false);

  async function report() {
    if (reported) return;
    setReported(true);
    try {
      const res = await fetch(`/api/tests/${testId}/report-grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success("Thanks — we'll review this grade.");
    } catch {
      setReported(false);
      toast.error("Could not send the report. Try again.");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void report()}
      disabled={reported}
      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:no-underline disabled:opacity-70"
    >
      {reported ? "Grade reported ✓" : "Report this grade"}
    </button>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-9 rounded-full border px-4 text-sm font-medium transition-colors",
        "focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card hover:border-primary/50 hover:bg-accent"
      )}
    >
      {label}
    </button>
  );
}
