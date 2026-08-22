"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Flag,
  LayoutGrid,
  Loader2,
} from "lucide-react";
import type { TakeState } from "@/lib/tests";
import type { OpenReport } from "@/lib/question-reports";
import { cn } from "@/lib/utils";
import { questionImageUrl } from "@/lib/storage";
import { QuestionImage } from "@/components/test/question-image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { AnswerOption } from "@/components/test/answer-option";
import { QuestionPalette } from "@/components/test/question-palette";
import { TestTimer } from "@/components/test/test-timer";
import { SubmitDialog } from "@/components/test/submit-dialog";
import { AutosaveIndicator } from "@/components/test/autosave-indicator";
import { useAnswerAutosave } from "@/components/test/use-answer-autosave";
import { ReportQuestionTap } from "@/components/report-question";

const LETTERS = "ABCDEFGH".split("");

/** The timed exam runner. Tutor sessions render TutorRunner instead. */
export function TestRunner({
  state,
  initialReports = [],
}: {
  state: TakeState;
  /** The student's open reports on this paper's questions. */
  initialReports?: OpenReport[];
}) {
  const router = useRouter();
  const { test, questions } = state;

  // Owned here, not by the tap: it remounts per question and would forget
  // an in-session toggle the moment the student navigated away and back.
  const [reports, setReports] = useState<Map<string, OpenReport>>(
    () => new Map(initialReports.map((r) => [r.questionId, r]))
  );
  const setReport = useCallback((questionId: string, next: OpenReport | null) => {
    setReports((prev) => {
      const copy = new Map(prev);
      if (next) copy.set(questionId, next);
      else copy.delete(questionId);
      return copy;
    });
  }, []);

  const [index, setIndex] = useState(() => {
    const firstUnanswered = questions.findIndex(
      (q) => q.selectedOptionIds.length === 0
    );
    return firstUnanswered === -1 ? 0 : firstUnanswered;
  });

  const {
    answers,
    setAnswers,
    saveState,
    scheduleSave,
    flush,
    cancelPendingFlush,
    accrueTime,
    beginStint,
  } = useAnswerAutosave(test.id, questions);

  const [submitting, setSubmitting] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const current = questions[index];

  // ── Track per-question time
  useEffect(() => {
    if (!current) return;
    const questionId = current.questionId;
    beginStint();

    // Bank whatever is left of the stint on the way out; answering already
    // banked (and reset) the part before the save, so this cannot double up.
    return () => accrueTime(questionId);
  }, [current, accrueTime, beginStint]);

  const select = useCallback(
    (optionId: string) => {
      if (!current) return;
      const multi = current.type === "mcq_multi";

      setAnswers((prev) => {
        const next = new Map(prev);
        const existing = next.get(current.questionId) ?? {
          selected: [],
          flagged: false,
        };
        const selected = multi
          ? existing.selected.includes(optionId)
            ? existing.selected.filter((id) => id !== optionId)
            : [...existing.selected, optionId]
          : [optionId];
        next.set(current.questionId, { ...existing, selected });
        return next;
      });

      // Before the save, not after: the debounced flush reads timeSpent.
      accrueTime(current.questionId);
      scheduleSave(current.questionId);
    },
    [accrueTime, current, scheduleSave, setAnswers]
  );

  const toggleFlag = useCallback(() => {
    if (!current) return;
    setAnswers((prev) => {
      const next = new Map(prev);
      const existing = next.get(current.questionId) ?? {
        selected: [],
        flagged: false,
      };
      next.set(current.questionId, {
        ...existing,
        flagged: !existing.flagged,
      });
      return next;
    });
    accrueTime(current.questionId);
    scheduleSave(current.questionId);
  }, [accrueTime, current, scheduleSave, setAnswers]);

  const go = useCallback(
    (nextIndex: number) => {
      setIndex(Math.max(0, Math.min(questions.length - 1, nextIndex)));
      setPaletteOpen(false);
    },
    [questions.length]
  );

  const submit = useCallback(async () => {
    setSubmitting(true);
    cancelPendingFlush();
    await flush();
    try {
      const res = await fetch(`/api/tests/${test.id}/submit`, {
        method: "POST",
      });
      if (!res.ok && res.status !== 409) throw new Error(String(res.status));
    } catch {
      // Fall through: the results page finalizes an expired test anyway.
    }
    router.replace(`/tests/${test.id}/results`);
  }, [cancelPendingFlush, flush, router, test.id]);

  const handleExpire = useCallback(() => {
    if (!submitting) void submit();
  }, [submit, submitting]);

  // ── Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;

      if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
      else if (e.key.toLowerCase() === "f") toggleFlag();
      else {
        const pos = LETTERS.indexOf(e.key.toUpperCase());
        if (pos >= 0 && current && pos < current.options.length) {
          select(current.options[pos].id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, go, index, select, toggleFlag]);

  const paletteEntries = useMemo(
    () =>
      questions.map((q, i) => {
        const a = answers.get(q.questionId);
        return {
          index: i,
          answered: (a?.selected.length ?? 0) > 0,
          flagged: a?.flagged ?? false,
        };
      }),
    [answers, questions]
  );

  const unansweredCount = paletteEntries.filter((e) => !e.answered).length;

  if (!current) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-muted-foreground">
          This test has no questions. Please start a new one.
        </p>
      </div>
    );
  }

  const answer = answers.get(current.questionId);
  const isMulti = current.type === "mcq_multi";

  const palette = (
    <QuestionPalette entries={paletteEntries} current={index} onJump={go} />
  );

  return (
    <div className="flex min-h-svh flex-col bg-background">
      {/* Sticky top bar: timer, progress, autosave */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
          <span className="text-sm font-medium tabular-nums">
            {index + 1}
            <span className="text-muted-foreground">/{questions.length}</span>
          </span>

          <AutosaveIndicator state={saveState} />

          <div className="ml-auto flex items-center gap-2">
            {/* Exam tests always have a deadline (CHECK-constrained); tutor
                sessions never reach this runner — take/page.tsx routes them
                to TutorRunner. */}
            {test.expires_at !== null && (
              <TestTimer
                expiresAt={test.expires_at}
                serverNow={state.serverNow}
                onExpire={handleExpire}
              />
            )}

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

        {/* Teal: this is forward progress through the paper, not a resource
            being used up. */}
        <div
          className="h-0.5 bg-teal transition-[width] duration-300"
          style={{ width: `${((index + 1) / questions.length) * 100}%` }}
          aria-hidden="true"
        />
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 gap-8 px-4 py-6 lg:py-10">
        {/* Question column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{current.subjectName}</Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleFlag}
              className={cn(
                "ml-auto",
                answer?.flagged && "text-primary"
              )}
              aria-pressed={answer?.flagged ?? false}
            >
              <Flag
                className={cn(answer?.flagged && "fill-current")}
                data-icon="inline-start"
              />
              {answer?.flagged ? "Flagged" : "Flag"}
            </Button>
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

          {/* A small text link under the stem, no shortcut — deliberately
              unlike the review flag above. */}
          <div className="mt-2">
            <ReportQuestionTap
              testId={test.id}
              questionId={current.questionId}
              report={reports.get(current.questionId) ?? null}
              onChange={(next) => setReport(current.questionId, next)}
            />
          </div>

          {isMulti && (
            <p className="mt-3 text-sm font-medium text-primary">
              Select all that apply.
            </p>
          )}

          <div className="mt-6 space-y-3">
            {current.options.map((opt, i) => (
              <AnswerOption
                key={opt.id}
                id={opt.id}
                groupName={`q-${current.questionId}`}
                label={opt.label}
                letter={LETTERS[i] ?? String(i + 1)}
                multi={isMulti}
                selected={answer?.selected.includes(opt.id) ?? false}
                onSelect={select}
              />
            ))}
          </div>

          {/* Desktop nav */}
          <div className="mt-8 hidden items-center gap-3 sm:flex">
            <Button
              variant="outline-muted"
              onClick={() => go(index - 1)}
              disabled={index === 0}
            >
              <ChevronLeft data-icon="inline-start" />
              Previous
            </Button>

            {index === questions.length - 1 ? (
              <SubmitDialog
                unanswered={unansweredCount}
                total={questions.length}
                submitting={submitting}
                onConfirm={submit}
              />
            ) : (
              <Button onClick={() => go(index + 1)} className="ml-auto">
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
              <SubmitDialog
                unanswered={unansweredCount}
                total={questions.length}
                submitting={submitting}
                onConfirm={submit}
                fullWidth
              />
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
            onClick={() => go(index - 1)}
            disabled={index === 0}
            aria-label="Previous question"
          >
            <ChevronLeft />
          </Button>

          {index === questions.length - 1 ? (
            <SubmitDialog
              unanswered={unansweredCount}
              total={questions.length}
              submitting={submitting}
              onConfirm={submit}
              fullWidth
            />
          ) : (
            <Button
              size="lg"
              className="flex-1"
              onClick={() => go(index + 1)}
            >
              Next
              <ChevronRight data-icon="inline-end" />
            </Button>
          )}
        </div>
      </div>

      {submitting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Submitting your test…</p>
          </div>
        </div>
      )}
    </div>
  );
}
