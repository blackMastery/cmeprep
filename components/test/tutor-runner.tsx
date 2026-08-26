"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Flag,
  LayoutGrid,
  Loader2,
  LogOut,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { TakeQuestion, TakeReveal, TakeState } from "@/lib/tests";
import { cn } from "@/lib/utils";
import { questionImageUrl } from "@/lib/storage";
import { QuestionImage } from "@/components/test/question-image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { AnswerOption, type AnswerState } from "@/components/test/answer-option";
import { ExplanationStrip } from "@/components/test/explanation-strip";
import { QuestionPalette } from "@/components/test/question-palette";
import { AutosaveIndicator } from "@/components/test/autosave-indicator";
import { useAnswerAutosave } from "@/components/test/use-answer-autosave";
import { BookmarkToggle } from "@/components/bookmark-toggle";
import { QuestionNoteEditor } from "@/components/question-note-editor";
import { ReportQuestionDialog } from "@/components/report-question";
import { useTutorWidgetHost } from "@/components/tutor/tutor-widget-provider";

const LETTERS = "ABCDEFGH".split("");

/**
 * The tutor-mode runner: untimed, each question grades and locks the moment
 * it is committed (single-answer: click or Enter; multi: the Check button),
 * then shows the explanation inline. Revealed questions reopen in that
 * locked state on resume — the server re-serves their reveal data.
 */
export function TutorRunner({
  state,
  initialBookmarkedIds,
  notesByQuestion,
  initialReportedIds = [],
}: {
  state: TakeState;
  initialBookmarkedIds: string[];
  notesByQuestion: Record<string, string>;
  /** Questions this student already has an open report on. */
  initialReportedIds?: string[];
}) {
  const router = useRouter();
  const { test, questions } = state;

  // Tutor mode is the one take screen that gets the floating AI tutor: the
  // answer key is already revealed per question, so a chat beside it gives
  // nothing away (SPEC §18). Exam and OSCE runners deliberately do not do
  // this. Registering also lifts the launcher above the mobile footer bar.
  useTutorWidgetHost("runner");

  const [index, setIndex] = useState(() => {
    const firstUnrevealed = questions.findIndex((q) => q.reveal === null);
    return firstUnrevealed === -1 ? 0 : firstUnrevealed;
  });

  const {
    answers,
    setAnswers,
    saveState,
    scheduleSave,
    flush,
    cancelPendingFlush,
    markClean,
    timeSpent,
    accrueTime,
    beginStint,
  } = useAnswerAutosave(test.id, questions);

  const [reveals, setReveals] = useState<Map<string, TakeReveal>>(() => {
    const initial = new Map<string, TakeReveal>();
    for (const q of questions) {
      if (q.reveal) initial.set(q.questionId, q.reveal);
    }
    return initial;
  });

  // Keyboard flow: letters only highlight; Enter commits. A stray keypress
  // must never irreversibly grade a question.
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [pendingReveal, setPendingReveal] = useState(false);
  const [missedOnly, setMissedOnly] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Owned here: the dialog remounts per question and would forget a report
  // filed this session when the student steps back to it.
  const [reportedIds, setReportedIds] = useState<Set<string>>(
    () => new Set(initialReportedIds)
  );

  const current = questions[index];

  // ── Track per-question time (same mechanism as the exam runner)
  useEffect(() => {
    if (!current) return;
    const questionId = current.questionId;
    beginStint();

    return () => accrueTime(questionId);
  }, [current, accrueTime, beginStint]);

  const reveal = useCallback(
    async (question: TakeQuestion, selection: string[]) => {
      if (pendingReveal || reveals.has(question.questionId)) return;
      if (selection.length === 0) return;
      setPendingReveal(true);

      // Show the committed selection immediately; the response may replace
      // it with the stored one if another tab revealed first.
      setAnswers((prev) => {
        const next = new Map(prev);
        const existing = next.get(question.questionId) ?? {
          selected: [],
          flagged: false,
        };
        next.set(question.questionId, { ...existing, selected: selection });
        return next;
      });

      // Bank the stint so far — the reveal is this question's final write.
      accrueTime(question.questionId);
      try {
        const res = await fetch(`/api/tests/${test.id}/reveal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId: question.questionId,
            selectedOptionIds: selection,
            timeSpentSec: timeSpent.current.get(question.questionId) ?? 0,
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data: {
          isCorrect: boolean;
          selectedOptionIds: string[];
          correctOptionIds: string[];
          explanation: string;
        } = await res.json();

        // Only now is the answer locked server-side, making any pending
        // autosave for this question redundant. Cleaning BEFORE the request
        // would drop the staged selection for good on a failed reveal —
        // nothing would ever flush it again.
        markClean(question.questionId);

        setReveals((prev) =>
          new Map(prev).set(question.questionId, {
            isCorrect: data.isCorrect,
            correctOptionIds: data.correctOptionIds,
            explanation: data.explanation,
          })
        );
        setAnswers((prev) => {
          const next = new Map(prev);
          const existing = next.get(question.questionId) ?? {
            selected: [],
            flagged: false,
          };
          next.set(question.questionId, {
            ...existing,
            selected: data.selectedOptionIds,
          });
          return next;
        });
        setHighlightedId(null);
      } catch {
        toast.error("Could not check that answer. Try again.");
      } finally {
        setPendingReveal(false);
      }
    },
    [
      accrueTime,
      markClean,
      pendingReveal,
      reveals,
      setAnswers,
      test.id,
      timeSpent,
    ]
  );

  const select = useCallback(
    (optionId: string) => {
      if (!current || reveals.has(current.questionId) || pendingReveal) return;
      const multi = current.type === "mcq_multi";

      if (!multi) {
        // Single answer: the click IS the commitment — grade instantly.
        void reveal(current, [optionId]);
        return;
      }

      // Multi: toggle and stage; the Check button commits the whole set.
      setAnswers((prev) => {
        const next = new Map(prev);
        const existing = next.get(current.questionId) ?? {
          selected: [],
          flagged: false,
        };
        const selected = existing.selected.includes(optionId)
          ? existing.selected.filter((id) => id !== optionId)
          : [...existing.selected, optionId];
        next.set(current.questionId, { ...existing, selected });
        return next;
      });
      scheduleSave(current.questionId);
    },
    [current, pendingReveal, reveal, reveals, scheduleSave, setAnswers]
  );

  const toggleFlag = useCallback(() => {
    if (!current || reveals.has(current.questionId)) return;
    setAnswers((prev) => {
      const next = new Map(prev);
      const existing = next.get(current.questionId) ?? {
        selected: [],
        flagged: false,
      };
      next.set(current.questionId, { ...existing, flagged: !existing.flagged });
      return next;
    });
    scheduleSave(current.questionId);
  }, [current, reveals, scheduleSave, setAnswers]);

  const go = useCallback(
    (nextIndex: number) => {
      setIndex(Math.max(0, Math.min(questions.length - 1, nextIndex)));
      setHighlightedId(null);
      setPaletteOpen(false);
    },
    [questions.length]
  );

  /** Indices of revealed-incorrect questions, for the missed-only filter. */
  const missedIndices = useMemo(
    () =>
      questions
        .map((q, i) => ({ q, i }))
        .filter(({ q }) => reveals.get(q.questionId)?.isCorrect === false)
        .map(({ i }) => i),
    [questions, reveals]
  );

  const step = useCallback(
    (direction: 1 | -1) => {
      if (!missedOnly) {
        go(index + direction);
        return;
      }
      const target =
        direction === 1
          ? missedIndices.find((i) => i > index)
          : [...missedIndices].reverse().find((i) => i < index);
      if (target !== undefined) go(target);
    },
    [go, index, missedIndices, missedOnly]
  );

  const finish = useCallback(async () => {
    setFinishing(true);
    cancelPendingFlush();
    await flush();
    try {
      const res = await fetch(`/api/tests/${test.id}/submit`, {
        method: "POST",
      });
      if (!res.ok && res.status !== 409) throw new Error(String(res.status));
      router.replace(`/tests/${test.id}/results`);
    } catch {
      toast.error("Could not finish the session. Try again.");
      setFinishing(false);
    }
  }, [cancelPendingFlush, flush, router, test.id]);

  const saveAndExit = useCallback(async () => {
    cancelPendingFlush();
    await flush();
    router.push("/dashboard");
  }, [cancelPendingFlush, flush, router]);

  // ── Keyboard: letters highlight (single) / toggle (multi), Enter commits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;

      if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key.toLowerCase() === "f") toggleFlag();
      else if (e.key === "Enter") {
        if (!current || reveals.has(current.questionId)) return;
        if (current.type === "mcq_multi") {
          const selected = answers.get(current.questionId)?.selected ?? [];
          void reveal(current, selected);
        } else if (highlightedId) {
          void reveal(current, [highlightedId]);
        }
      } else {
        const pos = LETTERS.indexOf(e.key.toUpperCase());
        if (pos >= 0 && current && pos < current.options.length) {
          if (reveals.has(current.questionId)) return;
          if (current.type === "mcq_multi") {
            select(current.options[pos].id);
          } else {
            setHighlightedId(current.options[pos].id);
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answers, current, highlightedId, reveal, reveals, select, step, toggleFlag]);

  const paletteEntries = useMemo(
    () =>
      questions.map((q, i) => {
        const a = answers.get(q.questionId);
        const r = reveals.get(q.questionId);
        return {
          index: i,
          answered: r !== undefined || (a?.selected.length ?? 0) > 0,
          flagged: (a?.flagged ?? false) && r === undefined,
          revealState: r ? (r.isCorrect ? ("correct" as const) : ("incorrect" as const)) : null,
          dimmed: missedOnly && r?.isCorrect !== false,
        };
      }),
    [answers, missedOnly, questions, reveals]
  );

  const revealedCount = reveals.size;
  const correctCount = useMemo(
    () => [...reveals.values()].filter((r) => r.isCorrect).length,
    [reveals]
  );
  const unansweredCount = questions.length - revealedCount;

  if (!current) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-muted-foreground">
          This session has no questions. Please start a new one.
        </p>
      </div>
    );
  }

  const answer = answers.get(current.questionId);
  const currentReveal = reveals.get(current.questionId) ?? null;
  const isMulti = current.type === "mcq_multi";
  const isRevealed = currentReveal !== null;

  const palette = (
    <div className="space-y-3">
      {missedIndices.length > 0 && (
        <button
          type="button"
          onClick={() => setMissedOnly((v) => !v)}
          aria-pressed={missedOnly}
          className={cn(
            "min-h-8 rounded-full border px-3 text-xs font-medium transition-colors",
            "focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
            missedOnly
              ? "border-destructive bg-destructive/10 text-destructive"
              : "border-border bg-card text-muted-foreground hover:border-destructive/50"
          )}
        >
          Missed only ({missedIndices.length})
        </button>
      )}
      <QuestionPalette entries={paletteEntries} current={index} onJump={go} />
    </div>
  );

  const finishDialog = (fullWidth: boolean) => (
    <FinishDialog
      unanswered={unansweredCount}
      total={questions.length}
      finishing={finishing}
      onConfirm={finish}
      fullWidth={fullWidth}
    />
  );

  return (
    <div className="flex min-h-svh flex-col bg-background">
      {/* Sticky top bar: progress, tally, autosave, save & exit */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
          <span className="text-sm font-medium tabular-nums">
            {index + 1}
            <span className="text-muted-foreground">/{questions.length}</span>
          </span>

          <Badge variant="secondary">Tutor</Badge>

          {revealedCount > 0 && (
            <span
              className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums"
              role="status"
            >
              {correctCount}/{revealedCount} correct
            </span>
          )}

          <AutosaveIndicator state={saveState} />

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={saveAndExit}
              disabled={finishing}
            >
              <LogOut data-icon="inline-start" />
              <span className="hidden sm:inline">Save &amp; exit</span>
            </Button>

            {/* Palette as a sheet on mobile */}
            <Sheet open={paletteOpen} onOpenChange={setPaletteOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline-muted"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Open question palette"
                >
                  <LayoutGrid />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[85vw] max-w-sm p-6">
                <SheetTitle className="mb-4 font-display text-lg">
                  Questions
                </SheetTitle>
                {palette}
              </SheetContent>
            </Sheet>
          </div>
        </div>

        {/* Progress = questions checked, not position — the honest measure
            of how much of the session is done. */}
        <div
          className="h-0.5 bg-teal transition-[width] duration-300"
          style={{ width: `${(revealedCount / questions.length) * 100}%` }}
          aria-hidden="true"
        />
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 gap-8 px-4 py-6 lg:py-10">
        {/* Question column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{current.subjectName}</Badge>
            {isRevealed ? (
              <span
                className={cn(
                  "ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                  currentReveal.isCorrect
                    ? "bg-success/10 text-success"
                    : "bg-destructive/10 text-destructive"
                )}
              >
                {currentReveal.isCorrect ? (
                  <Check className="size-3.5" strokeWidth={3} />
                ) : (
                  <X className="size-3.5" strokeWidth={3} />
                )}
                {currentReveal.isCorrect ? "Correct" : "Incorrect"}
              </span>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleFlag}
                className={cn("ml-auto", answer?.flagged && "text-primary")}
                aria-pressed={answer?.flagged ?? false}
              >
                <Flag
                  className={cn(answer?.flagged && "fill-current")}
                  data-icon="inline-start"
                />
                {answer?.flagged ? "Flagged" : "Flag"}
              </Button>
            )}
          </div>

          {/* The question stem is the hero — brand face, generous leading */}
          <h1 className="font-display text-xl leading-relaxed text-foreground sm:text-2xl sm:leading-relaxed">
            {current.stem}
          </h1>

          {questionImageUrl(current.imagePath) && (
            <div className="mt-4">
              <QuestionImage src={questionImageUrl(current.imagePath)!} />
            </div>
          )}

          {isMulti && !isRevealed && (
            <p className="mt-3 text-sm font-medium text-primary">
              Select all that apply, then check your answer.
            </p>
          )}

          <div className="mt-6 space-y-3">
            {current.options.map((opt, i) => {
              const selected = isRevealed
                ? (answer?.selected.includes(opt.id) ?? false)
                : isMulti
                  ? (answer?.selected.includes(opt.id) ?? false)
                  : highlightedId === opt.id;

              let optState: AnswerState = "idle";
              if (currentReveal) {
                const isCorrectOption = currentReveal.correctOptionIds.includes(
                  opt.id
                );
                if (selected && isCorrectOption) optState = "correct";
                else if (selected && !isCorrectOption) optState = "incorrect";
                else if (!selected && isCorrectOption) optState = "missed";
              }

              return (
                <AnswerOption
                  key={opt.id}
                  id={opt.id}
                  groupName={`q-${current.questionId}`}
                  label={opt.label}
                  letter={LETTERS[i] ?? String(i + 1)}
                  multi={isMulti}
                  selected={selected}
                  state={optState}
                  disabled={isRevealed || pendingReveal}
                  onSelect={select}
                />
              );
            })}
          </div>

          {isMulti && !isRevealed && (
            <div className="mt-5">
              <Button
                onClick={() => void reveal(current, answer?.selected ?? [])}
                disabled={pendingReveal || (answer?.selected.length ?? 0) === 0}
              >
                {pendingReveal ? (
                  <>
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                    Checking…
                  </>
                ) : (
                  "Check answer"
                )}
              </Button>
            </div>
          )}

          {isRevealed && (
            <div className="mt-6 space-y-4">
              <ExplanationStrip explanation={currentReveal.explanation} />
              {/* Tutor mode: the full dialog, offered only after the reveal —
                  the student has seen the key they're disputing. Keyed like
                  the note/bookmark below. */}
              <ReportQuestionDialog
                key={`report-${current.questionId}`}
                testId={test.id}
                questionId={current.questionId}
                reported={reportedIds.has(current.questionId)}
                onReported={() =>
                  setReportedIds((prev) => new Set(prev).add(current.questionId))
                }
              />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {/* Keyed by question: both children seed their state from
                      props with useState, which only runs on mount. Without a
                      key React reuses one instance across the whole session,
                      so stepping between questions carried the previous
                      question's note and bookmark over — and saving then wrote
                      that note onto the wrong question. */}
                  <QuestionNoteEditor
                    key={current.questionId}
                    questionId={current.questionId}
                    initialBody={notesByQuestion[current.questionId] ?? null}
                  />
                </div>
                <BookmarkToggle
                  key={current.questionId}
                  questionId={current.questionId}
                  initialBookmarked={initialBookmarkedIds.includes(
                    current.questionId
                  )}
                />
              </div>
            </div>
          )}

          {/* Desktop nav */}
          <div className="mt-8 hidden items-center gap-3 sm:flex">
            <Button
              variant="outline-muted"
              onClick={() => step(-1)}
              disabled={index === 0}
            >
              <ChevronLeft data-icon="inline-start" />
              Previous
            </Button>

            {index === questions.length - 1 ? (
              finishDialog(false)
            ) : (
              <Button onClick={() => step(1)} className="ml-auto">
                Next
                <ChevronRight data-icon="inline-end" />
              </Button>
            )}
          </div>
        </div>

        {/* Desktop palette */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-24 rounded-xl border border-border bg-card p-4">
            {palette}
            <div className="mt-4 border-t border-border pt-4">
              {finishDialog(true)}
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile sticky footer nav — thumb reachable */}
      <div className="sticky bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:hidden">
        <div className="flex items-center gap-2">
          <Button
            variant="outline-muted"
            size="icon-lg"
            onClick={() => step(-1)}
            disabled={index === 0}
            aria-label="Previous question"
          >
            <ChevronLeft />
          </Button>

          {index === questions.length - 1 ? (
            finishDialog(true)
          ) : (
            <Button size="lg" className="flex-1" onClick={() => step(1)}>
              Next
              <ChevronRight data-icon="inline-end" />
            </Button>
          )}
        </div>
      </div>

      {finishing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Wrapping up your session…
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Tutor's counterpart to SubmitDialog. Different contract, different copy:
 * unanswered questions DON'T count against the score (correct/answered), and
 * leaving without finishing is fine — the session resumes any time.
 */
function FinishDialog({
  unanswered,
  total,
  finishing,
  onConfirm,
  fullWidth = false,
}: {
  unanswered: number;
  total: number;
  finishing: boolean;
  onConfirm: () => void;
  fullWidth?: boolean;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          size="lg"
          className={cn(fullWidth ? "w-full" : "ml-auto")}
          disabled={finishing}
        >
          Finish session
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            Finish this session?
          </DialogTitle>
          <DialogDescription>
            {unanswered > 0 ? (
              <>
                {/* "questions" agrees with the TOTAL, and the trailing {" "}
                    keeps JSX from gluing "are" to "still". */}
                {unanswered} of {total} questions{" "}
                {unanswered === 1 ? "is" : "are"}{" "}
                still unchecked — they won&apos;t count toward your score. You
                can also save &amp; exit and pick the session up later.
              </>
            ) : (
              <>You checked every question. Nice work.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-2">
          <DialogClose asChild>
            <Button variant="outline-muted">Keep practising</Button>
          </DialogClose>
          <Button onClick={onConfirm} disabled={finishing}>
            {finishing ? "Finishing…" : "Finish session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
