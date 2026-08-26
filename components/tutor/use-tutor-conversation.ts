"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  mergeTranscript,
  validateQuestion,
  TUTOR_STATE_STALE_MS,
  type Citation,
  type TranscriptTurn,
  type TutorAccess,
  type TutorFeatures,
  type TutorStatePayload,
} from "@/lib/tutor-core";

/** How long a student waits before we explain the wait. The tutor service can
 * be cold-starting, which is the difference between "slow" and "broken". */
const WAKING_UP_MS = 10_000;

/** A cap or entitlement refusal from the server, held until the next state
 * load. `message` is always the SERVER's: the allowance rules are stated
 * once, in tutorAccessFor, and restating them here would let the two drift. */
export type Blocked = { message: string; upsell: boolean };

export type ConversationState = {
  turns: TranscriptTurn[];
  /** The composer's text. Lives here, not in a shell, so a question half
   * typed in the panel is still there on the full page. */
  draft: string;
  streaming: boolean;
  awaitingFirstToken: boolean;
  wakingUp: boolean;
  /** Questions left in the current window; null when unmetered or unknown. */
  left: number | null;
  limit: number | null;
  blocked: Blocked | null;
  retry: string | null;
  /** A verdict and transcript have been applied at least once. */
  loaded: boolean;
  loading: boolean;
  loadError: string | null;
  /** The session ended under us (401). Only a sign-in fixes it. */
  signedOut: boolean;
  features: TutorFeatures;
};

export type ConversationActions = {
  ask: (question: string) => Promise<void>;
  newConversation: () => Promise<void>;
  /** Fetch GET /api/tutor/state unless the store is fresh or streaming. */
  loadState: (opts?: { force?: boolean }) => Promise<void>;
  /** Apply a server-rendered state (the /tutor page) without a fetch. */
  seed: (state: TutorStatePayload) => void;
  setDraft: (draft: string) => void;
};

/**
 * The ONE conversation store (SPEC §18) — instantiated once by
 * TutorWidgetProvider and rendered by both the panel and the /tutor page.
 *
 * Every action is referentially stable: anything an action reads after an
 * `await` comes from a ref, never from a closed-over state value, so the
 * provider can hand the actions out in a memoised context without a rerender
 * per token reaching components that only need to open the panel.
 */
export function useConversationStore({
  onSettled,
}: {
  /** A stream finished (well or badly) — the provider marks unread. */
  onSettled?: (outcome: "done" | "error") => void;
} = {}): [ConversationState, ConversationActions] {
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [wakingUp, setWakingUp] = useState(false);
  const [awaitingFirstToken, setAwaitingFirstToken] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [retry, setRetry] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [features, setFeatures] = useState<TutorFeatures>({ context: false });

  const streamingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  /** When the transcript last matched the server: a load, or a stream
   * settling (the service persists the answer before it sends `done`). */
  const freshAtRef = useRef<number | null>(null);
  /** Sequence number of the newest state fetch. Only its response applies:
   * Strict Mode's doubled effects and open/close/open both start overlapping
   * GETs, and an older snapshot must not land on top of a newer one. */
  const seqRef = useRef(0);
  const inFlightRef = useRef(false);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  // The store outlives page navigation inside the app (that is the point —
  // closing the panel or changing page keeps the answer coming). But the
  // provider itself unmounts when the student leaves the authenticated
  // area — /admin, /org, sign-out — and a generation nobody will receive
  // should stop being generated (and billed).
  useEffect(() => () => abortRef.current?.abort(), []);

  const applyVerdict = useCallback((verdict: TutorAccess) => {
    if (verdict.allowed) {
      setLeft(verdict.remaining);
      setLimit(verdict.limit);
      setBlocked(null);
    } else {
      // 403-class reasons get the upsell; the daily cap just needs a clock.
      setBlocked({
        message: verdict.message,
        upsell: verdict.reason !== "daily_cap",
      });
    }
  }, []);

  const applyState = useCallback(
    (state: TutorStatePayload) => {
      setTurns((prev) => mergeTranscript(prev, state.turns));
      applyVerdict(state.verdict);
      setFeatures(state.features);
      setLoaded(true);
      setLoadError(null);
      setSignedOut(false);
      freshAtRef.current = Date.now();
    },
    [applyVerdict]
  );

  const seed = useCallback(
    (state: TutorStatePayload) => {
      // A server snapshot taken mid-stream holds the question and not the
      // answer; the live stream is the fresher view and wins.
      if (streamingRef.current) return;
      applyState(state);
    },
    [applyState]
  );

  const loadState = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (streamingRef.current) return;
      if (!force && inFlightRef.current) return;
      if (
        !force &&
        freshAtRef.current !== null &&
        Date.now() - freshAtRef.current < TUTOR_STATE_STALE_MS
      ) {
        return;
      }

      const seq = ++seqRef.current;
      inFlightRef.current = true;
      setLoading(true);
      try {
        const res = await fetch("/api/tutor/state", { cache: "no-store" });
        // Superseded, or a stream started while we waited — the snapshot
        // predates it and must not overwrite the live turns.
        if (seq !== seqRef.current || streamingRef.current) return;

        if (res.status === 401) {
          setSignedOut(true);
          return;
        }
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          setLoadError(payload?.error ?? "Couldn't load the tutor just now.");
          return;
        }
        applyState((await res.json()) as TutorStatePayload);
      } catch {
        if (seq === seqRef.current) {
          setLoadError("Couldn't load the tutor just now.");
        }
      } finally {
        if (seq === seqRef.current) {
          inFlightRef.current = false;
          setLoading(false);
        }
      }
    },
    [applyState]
  );

  const ask = useCallback(async (question: string) => {
    if (streamingRef.current) return;
    const guard = validateQuestion(question);
    if (guard) {
      toast.error(guard);
      return;
    }

    const askId = `local-ask-${Date.now()}`;
    setRetry(null);
    setDraft("");
    streamingRef.current = true;
    setStreaming(true);
    setAwaitingFirstToken(true);
    setTurns((prev) => [
      ...prev,
      { id: askId, role: "user", content: question },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    const wakeTimer = setTimeout(() => setWakingUp(true), WAKING_UP_MS);
    let outcome: "done" | "error" | "aborted" = "error";

    // The assistant turn is created empty and filled in as tokens land.
    const answerId = `local-answer-${askId}`;
    const appendToAnswer = (text: string) => {
      setTurns((prev) => {
        // Whether the turn exists is read from `prev`, never from a flag in
        // this closure. React double-invokes state updaters under Strict Mode
        // (on by default in the App Router): a `let opened` outside here is
        // flipped by the throwaway call, the real call then takes the append
        // branch, finds no turn to append to, and the ENTIRE answer is
        // silently dropped — tokens arrive, nothing renders.
        const i = prev.findIndex((t) => t.id === answerId);
        if (i === -1) {
          return [...prev, { id: answerId, role: "assistant", content: text }];
        }
        const next = [...prev];
        next[i] = { ...next[i], content: next[i].content + text };
        return next;
      });
    };

    const fail = (message: string) => {
      // Stop the upstream generation before discarding its turns: otherwise the
      // tutor keeps producing — and billing for — an answer nobody will read.
      // A no-op when the request already settled.
      controller.abort();
      toast.error(message);
      // Put the question back in the composer and drop both turns — a question
      // that produced nothing should not sit in the transcript looking answered.
      // Matched by id, not by text: asking the same thing twice is normal, and
      // the earlier answered copy must survive. `left` is NOT given back: the
      // server counted this question the moment it accepted it.
      setRetry(question);
      setDraft(question);
      setTurns((prev) =>
        prev.filter((t) => t.id !== answerId && t.id !== askId)
      );
    };

    try {
      const res = await fetch("/api/tutor/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        // Rejected before it reached the tutor (cap, entitlement, outage), so
        // nothing was counted — `left` is untouched.
        const payload = await res.json().catch(() => null);
        const message = payload?.error ?? "The tutor is unavailable right now.";
        if (res.status === 401) {
          // The session ended under us. Not a retryable failure: every later
          // request fails the same way until the student signs in again.
          setTurns((prev) => prev.filter((t) => t.id !== askId));
          setDraft(question);
          setSignedOut(true);
          outcome = "aborted";
          return;
        }
        // 403 and 429 are the two the route deliberately distinguishes: the
        // allowance is gone, so every later question fails identically. A toast
        // is the wrong shape for that — it disappears and leaves a composer
        // that looks usable. Keep the reason on screen and lock the composer;
        // 403 (no subscription / trial spent) also gets the upsell.
        if (res.status === 403 || res.status === 429) {
          setTurns((prev) => prev.filter((t) => t.id !== askId));
          setDraft(question);
          setBlocked({ message, upsell: payload?.code !== "daily_cap" });
          outcome = "aborted";
          return;
        }
        fail(message);
        return;
      }

      // Accepted: the tutor service writes the user row before it starts
      // generating, so this question is spent even if the answer then fails.
      // Waiting for `done` would advertise more allowance than the student
      // has, and the next page load would silently correct it downwards.
      setLeft((n) => (n === null ? null : Math.max(0, n - 1)));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawAnything = false;
      let sawDone = false;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE records are separated by a blank line; a network chunk can split
        // one anywhere, so only complete records are parsed.
        const records = buffer.split("\n\n");
        buffer = records.pop() ?? "";

        for (const record of records) {
          if (!record.startsWith("data:")) continue;
          let frame: {
            token?: string;
            done?: boolean;
            citations?: Citation[];
            message_id?: string;
            error?: string;
          };
          try {
            frame = JSON.parse(record.slice(5).trim());
          } catch {
            continue;
          }

          if (frame.error) {
            fail(frame.error);
            return;
          }
          if (typeof frame.token === "string") {
            setWakingUp(false);
            setAwaitingFirstToken(false);
            sawAnything = true;
            appendToAnswer(frame.token);
          }
          if (frame.done) {
            sawDone = true;
            const messageId = frame.message_id;
            const citations = frame.citations ?? [];
            // Re-keyed to the chat_messages id: a later state load merges by
            // id, and only a turn the server also holds keeps its citations.
            setTurns((prev) =>
              prev.map((t) =>
                t.id === answerId
                  ? { ...t, id: messageId ?? t.id, citations, messageId }
                  : t
              )
            );
          }
        }
      }

      if (!sawAnything) {
        fail("The tutor didn't answer — try again.");
      } else if (!sawDone) {
        // A stream can end cleanly without ever delivering `done`: the Vercel
        // function hit maxDuration, or the tutor instance was recycled
        // mid-answer. reader.read() reports a graceful EOF, so nothing else
        // here would notice — and the student would be left with a truncated
        // answer that looks finished.
        toast.error("That answer was cut off — ask again to get the rest.");
        outcome = "done";
      } else {
        outcome = "done";
      }
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        outcome = "aborted";
        return;
      }
      fail("Lost connection to the tutor. Your question is still here.");
    } finally {
      clearTimeout(wakeTimer);
      setWakingUp(false);
      setAwaitingFirstToken(false);
      setStreaming(false);
      streamingRef.current = false;
      abortRef.current = null;
      // The server has the exchange (or its failure) by now, so the store is
      // as fresh as a load would make it — and a load must not race the
      // service's asynchronous persist of a cut-off answer.
      freshAtRef.current = Date.now();
      if (outcome !== "aborted") onSettledRef.current?.(outcome);
    }
  }, []);

  const newConversation = useCallback(async () => {
    if (streamingRef.current) return;
    const res = await fetch("/api/tutor/reset", { method: "POST" });
    if (res.status === 401) {
      setSignedOut(true);
      return;
    }
    if (!res.ok) {
      toast.error("Couldn't start a new conversation. Try again.");
      return;
    }
    setTurns([]);
    setRetry(null);
    freshAtRef.current = Date.now();
  }, []);

  // The callbacks are stable, so the object holding them must be too:
  // consumers depend on `actions` (the provider's memo, the page's seed
  // effect), and a fresh object per render re-fires that effect, which sets
  // state, which renders, which... "Maximum update depth exceeded".
  const actions = useMemo<ConversationActions>(
    () => ({ ask, newConversation, loadState, seed, setDraft }),
    [ask, newConversation, loadState, seed]
  );

  return [
    {
      turns,
      draft,
      streaming,
      awaitingFirstToken,
      wakingUp,
      left,
      limit,
      blocked,
      retry,
      loaded,
      loading,
      loadError,
      signedOut,
      features,
    },
    actions,
  ];
}
