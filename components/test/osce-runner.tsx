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
import {
  OSCE_MIN_ANSWER_CHARS,
  OSCE_MAX_ANSWER_CHARS,
} from "@/lib/osce-grading-core";
import { cn } from "@/lib/utils";
import { questionImageUrl } from "@/lib/storage";
import { QuestionImage } from "@/components/test/question-image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { ExplanationStrip } from "@/components/test/explanation-strip";
import { QuestionPalette } from "@/components/test/question-palette";
import { TranslateControl } from "@/components/test/translate-control";
import { TranslationNotice } from "@/components/test/translation-notice";
import { TranslationChrome } from "@/components/test/translation-chrome";
import { useQuestionTranslation } from "@/components/test/use-question-translation";
import { seedTakeTranslations, translatedAttrs } from "@/lib/translation-ui-core";
import { AutosaveIndicator } from "@/components/test/autosave-indicator";
import { useAnswerAutosave } from "@/components/test/use-answer-autosave";
import { BookmarkToggle } from "@/components/bookmark-toggle";
import { QuestionNoteEditor } from "@/components/question-note-editor";

/**
 * The OSCE-station runner: untimed, one open question per station. The
 * student types free text and hits "Check answer" — the server grades it via
 * the AI judge, locks the station, and returns the verdict plus the model
 * answer. Graded stations reopen locked on resume, exactly like tutor mode.
 * A failed grade (AI outage, daily cap) keeps the textarea editable: the
 * typed answer is staged server-side and nothing is scored until a grade
 * succeeds.
 */
export function OsceRunner({
  state,
  initialBookmarkedIds,
  notesByQuestion,
  enabledLanguageCodes = [],
  initialLanguage = null,
}: {
  state: TakeState;
  initialBookmarkedIds: string[];
  notesByQuestion: Record<string, string>;
  /** Translation languages the admin has switched on; empty = feature off. */
  enabledLanguageCodes?: string[];
  /** tests.language, else the profile default. */
  initialLanguage?: string | null;
}) {
  const router = useRouter();
  const { test, questions } = state;

  const [index, setIndex] = useState(() => {
    const firstUngraded = questions.findIndex((q) => q.reveal === null);
    return firstUngraded === -1 ? 0 : firstUngraded;
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
  /** Graded answer text (from the server) per station — the immutable copy
   * shown once a station locks, distinct from the editable staged text. */
  const [gradedText, setGradedText] = useState<Map<string, string>>(() => {
    const initial = new Map<string, string>();
    for (const q of questions) {
      if (q.reveal) initial.set(q.questionId, q.answerText ?? "");
    }
    return initial;
  });
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());

  const [pendingGrade, setPendingGrade] = useState(false);
  const [missedOnly, setMissedOnly] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Per-question Translate: the station text now, the model answer and
  // explanation with the grade (same gate as the English ones). The judge is
  // told server-side that the answer may be in this language.
  const translation = useQuestionTranslation({
    testId: test.id,
    enabledLanguageCodes,
    initialLanguage,
    initial: () => seedTakeTranslations(questions),
  });
  // Stable (they read the latest state through a ref): grade() and the key
  // handler depend on them without re-subscribing on every state change.
  const { merge: mergeTranslation, toggle: toggleTranslation } = translation;

  const current = questions[index];

  // ── Track per-question time (same mechanism as the other runners)
  useEffect(() => {
    if (!current) return;
    const questionId = current.questionId;
    beginStint();

    return () => accrueTime(questionId);
  }, [current, accrueTime, beginStint]);

  const grade = useCallback(
    async (question: TakeQuestion, text: string) => {
      if (pendingGrade || reveals.has(question.questionId)) return;
      const trimmed = text.trim();
      if (trimmed.length < OSCE_MIN_ANSWER_CHARS) return;
      setPendingGrade(true);

      // Bank the stint so far — the grade is this station's final write.
      accrueTime(question.questionId);
      try {
        const res = await fetch(`/api/tests/${test.id}/grade`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId: question.questionId,
            answerText: trimmed,
            timeSpentSec: timeSpent.current.get(question.questionId) ?? 0,
          }),
        });
        if (!res.ok) {
          // The server's message is the useful part: length guard, daily cap
          // (429) or "grading unavailable, your text is saved" (502). The
          // staged text stays dirty locally so nothing is lost either way.
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          toast.error(
            body?.error ?? "Could not grade that answer. Try again."
          );
          return;
        }
        const data: {
          isCorrect: boolean;
          answerText: string;
          modelAnswer: string;
          explanation: string;
          translatedExplanation?: string;
          translatedModelAnswer?: string;
        } = await res.json();

        // Locked server-side only now — cleaning before the request would
        // orphan the staged text on a failed grade with no retry path.
        markClean(question.questionId);

        setReveals((prev) =>
          new Map(prev).set(question.questionId, {
            isCorrect: data.isCorrect,
            correctOptionIds: [],
            explanation: data.explanation,
            modelAnswer: data.modelAnswer,
          })
        );
        // A concurrent grade in another tab may have won with different text;
        // the server returns the stored (graded) answer either way.
        setGradedText((prev) =>
          new Map(prev).set(question.questionId, data.answerText)
        );
        if (
          data.translatedExplanation !== undefined ||
          data.translatedModelAnswer !== undefined
        ) {
          mergeTranslation(question.questionId, {
            ...(data.translatedExplanation !== undefined
              ? { explanation: data.translatedExplanation }
              : {}),
            ...(data.translatedModelAnswer !== undefined
              ? { modelAnswer: data.translatedModelAnswer }
              : {}),
          });
        }
      } catch {
        toast.error("Could not grade that answer. Try again.");
      } finally {
        setPendingGrade(false);
      }
    },
    [
      accrueTime,
      markClean,
      mergeTranslation,
      pendingGrade,
      reveals,
      test.id,
      timeSpent,
    ]
  );

  const setText = useCallback(
    (value: string) => {
      if (!current || reveals.has(current.questionId)) return;
      setAnswers((prev) => {
        const next = new Map(prev);
        const existing = next.get(current.questionId) ?? {
          selected: [],
          text: "",
          flagged: false,
        };
        next.set(current.questionId, { ...existing, text: value });
        return next;
      });
      scheduleSave(current.questionId);
    },
    [current, reveals, scheduleSave, setAnswers]
  );

  const toggleFlag = useCallback(() => {
    if (!current || reveals.has(current.questionId)) return;
    setAnswers((prev) => {
      const next = new Map(prev);
      const existing = next.get(current.questionId) ?? {
        selected: [],
        text: "",
        flagged: false,
      };
      next.set(current.questionId, { ...existing, flagged: !existing.flagged });
      return next;
    });
    scheduleSave(current.questionId);
  }, [current, reveals, scheduleSave, setAnswers]);

  const reportGrade = useCallback(
    async (questionId: string) => {
      if (reportedIds.has(questionId)) return;
      // Optimistic — the worst case is a swallowed duplicate server-side.
      setReportedIds((prev) => new Set(prev).add(questionId));
      try {
        const res = await fetch(`/api/tests/${test.id}/report-grade`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId }),
        });
        if (!res.ok) throw new Error(String(res.status));
        toast.success("Thanks — we'll review this grade.");
      } catch {
        setReportedIds((prev) => {
          const next = new Set(prev);
          next.delete(questionId);
          return next;
        });
        toast.error("Could not send the report. Try again.");
      }
    },
    [reportedIds, test.id]
  );

  const go = useCallback(
    (nextIndex: number) => {
      setIndex(Math.max(0, Math.min(questions.length - 1, nextIndex)));
      setPaletteOpen(false);
    },
    [questions.length]
  );

  /** Indices of graded-incorrect stations, for the missed-only filter. */
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
    // Never finalize with a grade in flight: its attempts row would land
    // after finalizeTest read them, so the score would permanently exclude a
    // station review still displays — and OSCE finalize writes no attempts,
    // so nothing heals it. The Finish button is disabled for the same reason;
    // this is the invariant itself.
    if (pendingGrade) return;
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
  }, [cancelPendingFlush, flush, pendingGrade, router, test.id]);

  const saveAndExit = useCallback(async () => {
    cancelPendingFlush();
    await flush();
    router.push("/dashboard");
  }, [cancelPendingFlush, flush, router]);

  // ── Keyboard: arrows navigate, F flags — no letter/Enter mechanics, the
  // textarea owns typing (the tagName guard keeps these inert while it has
  // focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;

      if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key.toLowerCase() === "f") toggleFlag();
      // T only flips an existing translation — never starts a paid request.
      else if (e.key.toLowerCase() === "t") {
        if (current) toggleTranslation(current.questionId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, step, toggleFlag, toggleTranslation]);

  const paletteEntries = useMemo(
    () =>
      questions.map((q, i) => {
        const a = answers.get(q.questionId);
        const r = reveals.get(q.questionId);
        return {
          index: i,
          answered: r !== undefined || (a?.text?.trim().length ?? 0) > 0,
          flagged: (a?.flagged ?? false) && r === undefined,
          revealState: r ? (r.isCorrect ? ("correct" as const) : ("incorrect" as const)) : null,
          dimmed: missedOnly && r?.isCorrect !== false,
        };
      }),
    [answers, missedOnly, questions, reveals]
  );

  const gradedCount = reveals.size;
  const correctCount = useMemo(
    () => [...reveals.values()].filter((r) => r.isCorrect).length,
    [reveals]
  );
  const ungradedCount = questions.length - gradedCount;

  if (!current) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-muted-foreground">
          This session has no stations. Please start a new one.
        </p>
      </div>
    );
  }

  const answer = answers.get(current.questionId);
  const currentReveal = reveals.get(current.questionId) ?? null;
  const isGraded = currentReveal !== null;
  const draft = answer?.text ?? "";
  const tooShort = draft.trim().length < OSCE_MIN_ANSWER_CHARS;
  const shown = translation.translationFor(current.questionId);
  const stemAttrs = translatedAttrs(shown?.language ?? null);
  const bodyAttrs = translatedAttrs(
    shown?.modelAnswer !== undefined ? shown.language : null
  );

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
      ungraded={ungradedCount}
      total={questions.length}
      finishing={finishing}
      // Separate from `finishing` so the button stays "Finish session" rather
      // than claiming to be finishing while a grade is still in flight.
      blocked={pendingGrade}
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

          <Badge variant="secondary">OSCE</Badge>

          {gradedCount > 0 && (
            <span
              className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums"
              role="status"
            >
              {correctCount}/{gradedCount} correct
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
                  aria-label="Open station palette"
                >
                  <LayoutGrid />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[85vw] max-w-sm p-6">
                <SheetTitle className="mb-4 font-display text-lg">
                  Stations
                </SheetTitle>
                {palette}
              </SheetContent>
            </Sheet>
          </div>
        </div>

        {/* Progress = stations graded, not position. */}
        <div
          className="h-0.5 bg-teal transition-[width] duration-300"
          style={{ width: `${(gradedCount / questions.length) * 100}%` }}
          aria-hidden="true"
        />
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 gap-8 px-4 py-6 lg:py-10">
        {/* Station column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{current.subjectName}</Badge>
            {/* The right-hand cluster keeps its alignment whether or not the
                Translate control renders (it doesn't when no language is on). */}
            <span className="ml-auto flex items-center gap-2">
              <TranslateControl api={translation} questionId={current.questionId} />
              {isGraded ? (
                <span
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
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
                  className={cn(answer?.flagged && "text-primary")}
                  aria-pressed={answer?.flagged ?? false}
                >
                  <Flag
                    className={cn(answer?.flagged && "fill-current")}
                    data-icon="inline-start"
                  />
                  {answer?.flagged ? "Flagged" : "Flag"}
                </Button>
              )}
            </span>
          </div>

          <TranslationNotice api={translation} />

          {/* The vignette is the hero — brand face, generous leading */}
          <h1
            className="font-display text-xl leading-relaxed text-foreground sm:text-2xl sm:leading-relaxed"
            {...stemAttrs}
          >
            {shown?.stem ?? current.stem}
          </h1>

          {questionImageUrl(current.imagePath) && (
            <div className="mt-4">
              <QuestionImage src={questionImageUrl(current.imagePath)!} />
            </div>
          )}

          {isGraded ? (
            <div className="mt-6 space-y-4">
              {/* The immutable graded answer, never the editable draft. */}
              <div className="rounded-xl border border-border bg-card px-4 py-3.5">
                <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Your answer
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                  {gradedText.get(current.questionId) ?? ""}
                </p>
              </div>

              <div className="rounded-xl border-l-2 border-teal bg-teal/5 px-4 py-3.5">
                <p className="mb-1 text-xs font-semibold tracking-wide text-teal uppercase">
                  Model answer
                </p>
                <p
                  className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90"
                  {...bodyAttrs}
                >
                  {shown?.modelAnswer ?? currentReveal.modelAnswer}
                </p>
              </div>

              <ExplanationStrip
                explanation={shown?.explanation ?? currentReveal.explanation}
                translated={
                  shown?.explanation !== undefined
                    ? { language: shown.language }
                    : null
                }
              />

              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {/* Keyed by question — see the tutor runner's note on
                      state-seeding children. */}
                  <QuestionNoteEditor
                    key={current.questionId}
                    questionId={current.questionId}
                    initialBody={notesByQuestion[current.questionId] ?? null}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void reportGrade(current.questionId)}
                    disabled={reportedIds.has(current.questionId)}
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:no-underline disabled:opacity-70"
                  >
                    {reportedIds.has(current.questionId)
                      ? "Grade reported ✓"
                      : "Report this grade"}
                  </button>
                  <BookmarkToggle
                    key={current.questionId}
                    questionId={current.questionId}
                    initialBookmarked={initialBookmarkedIds.includes(
                      current.questionId
                    )}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              <Textarea
                key={current.questionId}
                value={draft}
                onChange={(e) => setText(e.target.value)}
                maxLength={OSCE_MAX_ANSWER_CHARS}
                rows={6}
                placeholder="Type your answer — diagnosis, findings, management steps…"
                disabled={pendingGrade}
                aria-label="Your answer"
                className="min-h-36 text-base leading-relaxed"
              />
              <div className="flex items-center gap-3">
                <Button
                  onClick={() => void grade(current, draft)}
                  disabled={pendingGrade || tooShort}
                >
                  {pendingGrade ? (
                    <>
                      <Loader2 className="animate-spin" data-icon="inline-start" />
                      Grading…
                    </>
                  ) : (
                    "Check answer"
                  )}
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {tooShort
                    ? `At least ${OSCE_MIN_ANSWER_CHARS} characters`
                    : `${draft.length}/${OSCE_MAX_ANSWER_CHARS}`}
                </span>
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
            aria-label="Previous station"
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

      <TranslationChrome api={translation} />
    </div>
  );
}

/**
 * OSCE's counterpart to the tutor FinishDialog: ungraded stations don't
 * count against the score (correct/graded), and leaving without finishing
 * is fine — the session resumes any time.
 */
function FinishDialog({
  ungraded,
  total,
  finishing,
  blocked = false,
  onConfirm,
  fullWidth = false,
}: {
  ungraded: number;
  total: number;
  finishing: boolean;
  /** A grade is in flight — finishing now would drop it from the score. */
  blocked?: boolean;
  onConfirm: () => void;
  fullWidth?: boolean;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          size="lg"
          className={cn(fullWidth ? "w-full" : "ml-auto")}
          disabled={finishing || blocked}
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
            {ungraded > 0 ? (
              <>
                {ungraded} of {total} stations{" "}
                {ungraded === 1 ? "is" : "are"} still ungraded — they
                won&apos;t count toward your score. You can also save &amp;
                exit and pick the session up later.
              </>
            ) : (
              <>You checked every station. Nice work.</>
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
