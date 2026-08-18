"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { submitQuiz, type QuizSubmitState } from "@/app/(app)/cme/actions";
import type { QuizFeedback, QuizQuestionView } from "@/lib/courses";
import type { CourseQuizAttempt } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";

type AttemptRow = Pick<
  CourseQuizAttempt,
  "id" | "score_pct" | "passed" | "created_at"
>;

/**
 * Formative quiz: every question on one page, one submit, instant results
 * (spec §5). Deliberately lighter than the test runner — no timer, palette
 * or shuffling. Grading is entirely server-side; this component only ever
 * sees correctness inside the returned feedback of a graded attempt.
 */
export function QuizRunner({
  courseId,
  lessonId,
  questions,
  passPct,
  alreadyPassed,
  attempts,
}: {
  courseId: string;
  lessonId: string;
  questions: QuizQuestionView[];
  passPct: number;
  alreadyPassed: boolean;
  attempts: AttemptRow[];
}) {
  const [state, action, pending] = useActionState<QuizSubmitState, FormData>(
    submitQuiz,
    null
  );
  const [picks, setPicks] = useState<Record<string, string>>({});
  // "Retake" hides the last feedback without being able to reset the action
  // state itself — a new submission replaces the reference and shows again.
  const [dismissed, setDismissed] = useState<QuizFeedback | null>(null);

  const feedback =
    state && "feedback" in state && state.feedback !== dismissed
      ? state.feedback
      : null;
  const error = state && "error" in state ? state.error : null;

  if (questions.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          This quiz has no questions yet — check back later.
        </CardContent>
      </Card>
    );
  }

  if (feedback) {
    return (
      <QuizResults
        questions={questions}
        feedback={feedback}
        onRetake={() => {
          setDismissed(feedback);
          setPicks({});
        }}
      />
    );
  }

  const answers = Object.entries(picks).map(([questionId, optionId]) => ({
    questionId,
    optionId,
  }));

  return (
    <div className="space-y-4">
      {alreadyPassed && (
        <p className="flex items-center gap-2 text-sm font-medium text-primary">
          <CheckCircle2 className="size-4" aria-hidden />
          You&apos;ve passed this quiz — retakes are unlimited and can&apos;t
          lower it.
        </p>
      )}

      <form action={action} className="space-y-4">
        <input type="hidden" name="courseId" value={courseId} />
        <input type="hidden" name="lessonId" value={lessonId} />
        <input type="hidden" name="answers" value={JSON.stringify(answers)} />

        <ol className="space-y-4">
          {questions.map((question, index) => (
            <li key={question.id}>
              <Card className="[--card-spacing:--spacing(5)]">
                <CardContent className="space-y-3">
                  <div className="flex gap-2 text-sm font-medium">
                    <span className="text-muted-foreground">{index + 1}.</span>
                    <Markdown className="min-w-0">{question.promptMd}</Markdown>
                  </div>
                  <fieldset className="space-y-1.5">
                    <legend className="sr-only">
                      Options for question {index + 1}
                    </legend>
                    {question.options.map((option) => (
                      <label
                        key={option.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors",
                          picks[question.id] === option.id
                            ? "border-primary bg-secondary/60"
                            : "hover:bg-secondary/40"
                        )}
                      >
                        <input
                          type="radio"
                          name={`q-${question.id}`}
                          checked={picks[question.id] === option.id}
                          onChange={() =>
                            setPicks((prev) => ({
                              ...prev,
                              [question.id]: option.id,
                            }))
                          }
                          className="size-4 accent-primary"
                        />
                        {option.label}
                      </label>
                    ))}
                  </fieldset>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={pending || answers.length < questions.length}
            aria-busy={pending}
          >
            {pending ? "Grading…" : "Submit answers"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {answers.length}/{questions.length} answered · pass mark {passPct}%
          </p>
        </div>
      </form>

      <AttemptHistory attempts={attempts} />
    </div>
  );
}

function QuizResults({
  questions,
  feedback,
  onRetake,
}: {
  questions: QuizQuestionView[];
  feedback: QuizFeedback;
  onRetake: () => void;
}) {
  const byQuestion = new Map(feedback.results.map((r) => [r.questionId, r]));

  return (
    <div className="space-y-4">
      <Card
        className={cn(
          "[--card-spacing:--spacing(5)]",
          feedback.passed ? "border-primary/40" : "border-destructive/40"
        )}
      >
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {feedback.passed ? (
              <CheckCircle2 className="size-8 text-primary" aria-hidden />
            ) : (
              <XCircle className="size-8 text-destructive" aria-hidden />
            )}
            <div>
              <p className="font-display text-xl font-semibold">
                {feedback.scorePct}%{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  · pass mark {feedback.passPct}%
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                {feedback.passed
                  ? "Passed — the next module is unlocked."
                  : "Not this time. Review the answers below and try again."}
              </p>
            </div>
          </div>
          <Button variant={feedback.passed ? "outline-muted" : "default"} onClick={onRetake}>
            <RotateCcw data-icon="inline-start" />
            Retake quiz
          </Button>
        </CardContent>
      </Card>

      <ol className="space-y-4">
        {questions.map((question, index) => {
          const result = byQuestion.get(question.id);
          return (
            <li key={question.id}>
              <Card className="[--card-spacing:--spacing(5)]">
                <CardContent className="space-y-3">
                  <div className="flex gap-2 text-sm font-medium">
                    <span className="text-muted-foreground">{index + 1}.</span>
                    <Markdown className="min-w-0">{question.promptMd}</Markdown>
                  </div>
                  <ul className="space-y-1.5">
                    {question.options.map((option) => {
                      const isCorrect = option.id === result?.correctOptionId;
                      const isPick = option.id === result?.pickedOptionId;
                      return (
                        <li
                          key={option.id}
                          className={cn(
                            "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm",
                            isCorrect && "border-primary bg-primary/5",
                            isPick && !isCorrect && "border-destructive bg-destructive/5"
                          )}
                        >
                          {isCorrect ? (
                            <CheckCircle2
                              className="size-4 shrink-0 text-primary"
                              aria-hidden
                            />
                          ) : isPick ? (
                            <XCircle
                              className="size-4 shrink-0 text-destructive"
                              aria-hidden
                            />
                          ) : (
                            <span className="size-4 shrink-0" aria-hidden />
                          )}
                          <span className="min-w-0">{option.label}</span>
                          {isPick && (
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                              Your answer
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {result?.explanationMd && (
                    // ExplanationStrip's visual, but markdown-capable — its
                    // prop is a plain-text <p>.
                    <div className="rounded-xl border-l-2 border-primary bg-secondary/60 px-4 py-3.5">
                      <p className="mb-1 text-xs font-semibold tracking-wide text-primary uppercase">
                        Explanation
                      </p>
                      <Markdown className="text-foreground/90">
                        {result.explanationMd}
                      </Markdown>
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function AttemptHistory({ attempts }: { attempts: AttemptRow[] }) {
  if (attempts.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Previous attempts
      </h3>
      <ul className="space-y-1 text-sm">
        {attempts.map((attempt) => (
          <li key={attempt.id} className="flex items-center gap-2 text-muted-foreground">
            <span
              className={cn(
                "font-medium tabular-nums",
                attempt.passed ? "text-primary" : "text-foreground/70"
              )}
            >
              {attempt.score_pct}%
            </span>
            <span>{attempt.passed ? "Passed" : "Failed"}</span>
            <span className="text-xs">
              {new Date(attempt.created_at).toLocaleDateString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
