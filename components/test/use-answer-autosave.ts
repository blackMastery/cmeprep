"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TakeQuestion } from "@/lib/tests";
import type { SaveState } from "@/components/test/autosave-indicator";

const AUTOSAVE_DEBOUNCE_MS = 800;

export type LocalAnswer = {
  selected: string[];
  /** OSCE free text. The OSCE runner seeds this for EVERY question (so the
   * payload rows stay uniform); MCQ runners leave it undefined and it never
   * enters their payloads. */
  text?: string;
  flagged: boolean;
};

/**
 * The staged-answer machinery shared by the exam, tutor and OSCE runners:
 * local answer state, the debounced PATCH autosave, and the pagehide beacon
 * flush. Extracted from TestRunner verbatim — behavior must not drift, all
 * runners depend on its exact save semantics.
 */
export function useAnswerAutosave(testId: string, questions: TakeQuestion[]) {
  const [answers, setAnswers] = useState<Map<string, LocalAnswer>>(() => {
    const initial = new Map<string, LocalAnswer>();
    for (const q of questions) {
      initial.set(q.questionId, {
        selected: q.selectedOptionIds,
        ...(q.type === "osce" ? { text: q.answerText ?? "" } : {}),
        flagged: q.flagged,
      });
    }
    return initial;
  });

  const [saveState, setSaveState] = useState<SaveState>("idle");

  const dirtyRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeSpent = useRef<Map<string, number>>(new Map());

  /** Start of the current, not-yet-banked stint on the displayed question. */
  const stintStartedAtRef = useRef<number>(0);

  /** Start the clock for the question now on screen. */
  const beginStint = useCallback(() => {
    stintStartedAtRef.current = Date.now();
  }, []);

  /**
   * Bank the time spent on `questionId` since the last accrual and restart
   * the stint clock.
   *
   * Must be called BEFORE scheduling a save, not only when the question is
   * left: the autosave fires ~800ms after the answer while the learner is
   * still on the question, so a total banked only on exit was always written
   * as 0 — and the question is clean by then, so nothing ever corrected it.
   * Every exam attempt landed with time_spent_sec = 0, which is what made the
   * org pacing signal read "about 0s per question".
   *
   * Resetting the clock on each accrual is what keeps the exit accrual from
   * double-counting the stint this call just banked.
   */
  const accrueTime = useCallback((questionId: string) => {
    const now = Date.now();
    const elapsed = Math.round((now - stintStartedAtRef.current) / 1000);
    stintStartedAtRef.current = now;
    const spent = timeSpent.current;
    spent.set(questionId, (spent.get(questionId) ?? 0) + elapsed);
  }, []);

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

  const buildPayload = useCallback(
    (ids: string[]) => ({
      answers: ids.flatMap((questionId) => {
        const answer = answersRef.current.get(questionId);
        if (!answer) return [];
        return [
          {
            questionId,
            selectedOptionIds: answer.selected,
            ...(answer.text !== undefined ? { answerText: answer.text } : {}),
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
      const res = await fetch(`/api/tests/${testId}/answers`, {
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
  }, [buildPayload, testId]);

  const scheduleSave = useCallback(
    (questionId: string) => {
      dirtyRef.current.add(questionId);
      setSaveState("saving");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
    },
    [flush]
  );

  /** Stop the debounce timer (before an explicit flush, e.g. submit). */
  const cancelPendingFlush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  /**
   * Tutor mode: once a question is revealed its staged answer is locked
   * server-side — drop any pending save so the runner doesn't try (and the
   * indicator doesn't claim) to save a selection the server would ignore.
   * Call only AFTER the reveal succeeded, or the staged selection is
   * orphaned with no retry path.
   */
  const markClean = useCallback((questionId: string) => {
    dirtyRef.current.delete(questionId);
    // scheduleSave already flipped the indicator to "saving"; if this was
    // the only dirty question, the debounced flush will no-op and nothing
    // else would ever resolve the state — it would read "Saving…" forever.
    if (dirtyRef.current.size === 0) {
      setSaveState((s) => (s === "saving" ? "idle" : s));
    }
  }, []);

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
        `/api/tests/${testId}/answers?beacon=1`,
        new Blob([JSON.stringify(payload)], { type: "application/json" })
      );
    };
    document.addEventListener("pagehide", onHide);
    return () => document.removeEventListener("pagehide", onHide);
  }, [buildPayload, testId]);

  return {
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
  };
}
