"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Flag,
  LayoutGrid,
  Loader2,
} from "lucide-react";
import type { TakeState } from "@/lib/tests";
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
import { AutosaveIndicator, type SaveState } from "@/components/test/autosave-indicator";

const LETTERS = "ABCDEFGH".split("");
const AUTOSAVE_DEBOUNCE_MS = 800;

type LocalAnswer = { selected: string[]; flagged: boolean };

export function TestRunner({ state }: { state: TakeState }) {
  const router = useRouter();
  const { test, questions } = state;

  const [index, setIndex] = useState(() => {
    const firstUnanswered = questions.findIndex(
      (q) => q.selectedOptionIds.length === 0
    );
    return firstUnanswered === -1 ? 0 : firstUnanswered;
  });

  const [answers, setAnswers] = useState<Map<string, LocalAnswer>>(() => {
    const initial = new Map<string, LocalAnswer>();
    for (const q of questions) {
      initial.set(q.questionId, {
        selected: q.selectedOptionIds,
        flagged: q.flagged,
      });
    }
    return initial;
  });

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const dirtyRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const questionEnteredAt = useRef<number>(0);
  const timeSpent = useRef<Map<string, number>>(new Map());

  // The debounced flush runs ~800ms after a click, but a callback closed over
  // `answers` would serialize the value from the render that scheduled it —
  // i.e. always one interaction stale, silently dropping the user's most
  // recent answer or flag. Reading through a ref at flush time fixes that.
  // Synced in an effect (not during render) so concurrent rendering stays safe;
  // the commit lands long before the debounce fires.
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const current = questions[index];

  // ── Track per-question time
  useEffect(() => {
    if (!current) return;
    const questionId = current.questionId;
    const spent = timeSpent.current;
    questionEnteredAt.current = Date.now();

    return () => {
      const elapsed = Math.round(
        (Date.now() - questionEnteredAt.current) / 1000
      );
      spent.set(questionId, (spent.get(questionId) ?? 0) + elapsed);
    };
  }, [current]);

  const buildPayload = useCallback(
    (ids: string[]) => ({
      answers: ids.flatMap((questionId) => {
        const answer = answersRef.current.get(questionId);
        if (!answer) return [];
        return [
          {
            questionId,
            selectedOptionIds: answer.selected,
            flagged: answer.flagged,
            timeSpentSec: timeSpent.current.get(questionId) ?? 0,
          },
        ];
      }),
    }),
    []
  );

  const flush = useCallback(async () => {
    const ids = [...dirtyRef.current];
    if (ids.length === 0) return;
    dirtyRef.current.clear();

    const payload = buildPayload(ids);
    if (payload.answers.length === 0) return;

    setSaveState("saving");
    try {
      const res = await fetch(`/api/tests/${test.id}/answers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSaveState("saved");

      // Fade the confirmation back out; cleared on unmount below.
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(
        () => setSaveState((s) => (s === "saved" ? "idle" : s)),
        2500
      );
    } catch {
      // Put them back so the next tick retries.
      ids.forEach((id) => dirtyRef.current.add(id));
      setSaveState("error");
    }
  }, [buildPayload, test.id]);

  const scheduleSave = useCallback(
    (questionId: string) => {
      dirtyRef.current.add(questionId);
      setSaveState("saving");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
    },
    [flush]
  );

  // Don't leave timers running after the test screen goes away.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // ── Flush pending work when the page goes away (tab close, phone lock).
  useEffect(() => {
    const onHide = () => {
      const ids = [...dirtyRef.current];
      if (ids.length === 0) return;
      const payload = buildPayload(ids);
      if (payload.answers.length === 0) return;
      // sendBeacon survives unload where fetch may not.
      navigator.sendBeacon?.(
        `/api/tests/${test.id}/answers?beacon=1`,
        new Blob([JSON.stringify(payload)], { type: "application/json" })
      );
    };
    document.addEventListener("pagehide", onHide);
    return () => document.removeEventListener("pagehide", onHide);
  }, [buildPayload, test.id]);

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

      scheduleSave(current.questionId);
    },
    [current, scheduleSave]
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
    scheduleSave(current.questionId);
  }, [current, scheduleSave]);

  const go = useCallback(
    (nextIndex: number) => {
      setIndex(Math.max(0, Math.min(questions.length - 1, nextIndex)));
      setPaletteOpen(false);
    },
    [questions.length]
  );

  const submit = useCallback(async () => {
    setSubmitting(true);
    if (timerRef.current) clearTimeout(timerRef.current);
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
  }, [flush, router, test.id]);

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
            <TestTimer
              expiresAt={test.expires_at}
              serverNow={state.serverNow}
              onExpire={handleExpire}
            />

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

        <div
          className="h-0.5 bg-primary transition-[width] duration-300"
          style={{ width: `${((index + 1) / questions.length) * 100}%` }}
          aria-hidden="true"
        />
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 gap-8 px-4 py-6 lg:py-10">
        {/* Question column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{current.subjectName}</Badge>
            <span className="text-xs text-muted-foreground">
              {current.topicName}
            </span>
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
