"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Info, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { CitationList } from "@/components/tutor/citation-list";
import { ReportButton } from "@/components/tutor/report-button";
import {
  TUTOR_MIN_QUESTION_CHARS,
  validateQuestion,
  type Citation,
} from "@/lib/tutor-core";
import type { TutorTurn } from "@/lib/tutor";

/** How long a student waits before we explain the wait. The tutor service can
 * be cold-starting, which is the difference between "slow" and "broken". */
const WAKING_UP_MS = 10_000;

/** How close to the bottom still counts as "following along", in px. Below
 * this the student has scrolled up to reread and must not be yanked back. */
const PINNED_SLACK_PX = 120;

/** Layout effect on the client, plain effect during SSR.
 *
 * The scroll correction below MUST land before the browser paints, and calling
 * useLayoutEffect while rendering on the server logs a warning. Client
 * Components are server-rendered for the initial HTML, so the swap is real. */
const useBeforePaint =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

type Turn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  /** chat_messages id — only known for answers we can report. */
  messageId?: string;
};

/** A cap or entitlement refusal from the server, held until the page reloads.
 * `message` is always the SERVER's: the allowance rules are stated once, in
 * tutorAccessFor, and restating them here would let the two drift. */
type Blocked = { message: string; upsell: boolean };

export function TutorChat({
  initialTurns,
  remaining,
  limit,
}: {
  initialTurns: TutorTurn[];
  /** Questions left in the current window; null when unmetered (admins). */
  remaining: number | null;
  limit: number | null;
}) {
  const [turns, setTurns] = useState<Turn[]>(() =>
    initialTurns.map((t) => ({
      id: t.id,
      role: t.role,
      content: t.content,
      // TutorTurn.id IS the chat_messages row id, so answers stay reportable
      // after a reload — otherwise a student could only flag a bad answer
      // during the few seconds it was streaming. The report route re-checks
      // ownership, so handing the id to the client costs nothing.
      messageId: t.role === "assistant" ? t.id : undefined,
    }))
  );
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [wakingUp, setWakingUp] = useState(false);
  const [left, setLeft] = useState(remaining);
  const [retry, setRetry] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [awaitingFirstToken, setAwaitingFirstToken] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  /** Whether the student is following the bottom of the transcript. */
  const pinnedRef = useRef(true);

  useEffect(() => {
    const onScroll = () => {
      const slack =
        document.documentElement.scrollHeight -
        window.scrollY -
        window.innerHeight;
      pinnedRef.current = slack < PINNED_SLACK_PX;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useBeforePaint(() => {
    // Only follow the answer down while the student is already at the bottom.
    // Streaming appends on every token, and scrolling unconditionally makes it
    // impossible to scroll up and reread while the rest of the answer arrives.
    if (!pinnedRef.current) return;
    // BEFORE paint, and to an absolute position rather than via scrollIntoView.
    // The composer is `sticky bottom-0`, so every token that grows the
    // transcript pushes its resting position down; correcting the scroll in a
    // passive effect let the browser paint one frame with the composer
    // displaced and the next with it back — a ~30px bounce on every token
    // (measured: its viewport top oscillating 769 <-> 802). Running before
    // paint means the growth and the correction land in the same frame.
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "instant",
    });
  }, [turns, streaming]);

  // Cancel an in-flight generation if the student navigates away, so the
  // answer they'll never read stops being generated (and billed).
  useEffect(() => () => abortRef.current?.abort(), []);

  async function ask(question: string) {
    const guard = validateQuestion(question);
    if (guard) {
      toast.error(guard);
      return;
    }

    const askId = `local-ask-${Date.now()}`;
    setRetry(null);
    setDraft("");
    setStreaming(true);
    setAwaitingFirstToken(true);
    setTurns((prev) => [
      ...prev,
      { id: askId, role: "user", content: question },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    const wakeTimer = setTimeout(() => setWakingUp(true), WAKING_UP_MS);

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
        // 403 and 429 are the two the route deliberately distinguishes: the
        // allowance is gone, so every later question fails identically. A toast
        // is the wrong shape for that — it disappears and leaves a composer
        // that looks usable. Keep the reason on screen and lock the composer;
        // 403 (no subscription / trial spent) also gets the upsell.
        if (res.status === 403 || res.status === 429) {
          setTurns((prev) => prev.filter((t) => t.id !== askId));
          setDraft(question);
          setBlocked({ message, upsell: payload?.code !== "daily_cap" });
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
            setTurns((prev) =>
              prev.map((t) =>
                t.id === answerId
                  ? {
                      ...t,
                      citations: frame.citations ?? [],
                      messageId: frame.message_id,
                    }
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
      }
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
      fail("Lost connection to the tutor. Your question is still here.");
    } finally {
      clearTimeout(wakeTimer);
      setWakingUp(false);
      setAwaitingFirstToken(false);
      setStreaming(false);
      abortRef.current = null;
    }
  }

  async function newConversation() {
    if (streaming) return;
    const res = await fetch("/api/tutor/reset", { method: "POST" });
    if (!res.ok) {
      toast.error("Couldn't start a new conversation. Try again.");
      return;
    }
    setTurns([]);
    setRetry(null);
  }

  const locked = blocked !== null;

  return (
    <div className="flex min-h-[60vh] flex-col">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            AI tutor
          </h1>
          <p className="mt-1 text-muted-foreground">
            Ask anything from your course materials.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {left !== null && limit !== null && (
            <p className="text-xs tabular-nums text-muted-foreground">
              {left} of {limit} left
            </p>
          )}
          {turns.length > 0 && (
            <Button
              variant="outline-muted"
              size="sm"
              onClick={newConversation}
              disabled={streaming}
            >
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
              New conversation
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 space-y-6">
        {turns.length === 0 && !streaming && <EmptyState onPick={ask} />}

        {turns.map((turn) =>
          turn.role === "user" ? (
            <div key={turn.id} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-secondary px-4 py-2.5 text-sm whitespace-pre-wrap">
                {turn.content}
              </p>
            </div>
          ) : (
            <div key={turn.id} className="max-w-[95%]">
              <Markdown className="text-sm">{turn.content}</Markdown>
              {turn.citations && <CitationList citations={turn.citations} />}
              {turn.messageId && <ReportButton messageId={turn.messageId} />}
            </div>
          )
        )}

        {/* Only until the first token lands. Leaving it under a streaming
            answer both lies ("looking through your materials" while it is
            plainly answering) and reserves space that collapses when the
            stream ends, shifting everything one last time. */}
        {streaming && awaitingFirstToken && <Thinking wakingUp={wakingUp} />}
      </div>

      <div className="sticky bottom-0 mt-6 space-y-2 bg-background pt-3 pb-4">
        {blocked && (
          <div className="rounded-xl border border-border bg-muted/50 px-4 py-3">
            <p className="text-sm text-muted-foreground">{blocked.message}</p>
            {blocked.upsell && (
              <Button size="sm" className="mt-2.5" asChild>
                <Link href="/#pricing">View plans</Link>
              </Button>
            )}
          </div>
        )}

        {retry && !streaming && !locked && (
          <Button variant="outline" size="sm" onClick={() => ask(retry)}>
            Retry that question
          </Button>
        )}

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!streaming && !locked) ask(draft);
          }}
        >
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks a line — the convention every
              // chat UI shares, and the composer is one line most of the time.
              // isComposing guards IME input, where Enter commits the candidate
              // rather than finishing the sentence.
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                if (!streaming && !locked) ask(draft);
              }
            }}
            placeholder="Ask about anything in your study materials…"
            rows={2}
            className="min-h-[3.25rem] resize-none rounded-2xl"
            // Deliberately NOT disabled while streaming: disabling blurs the
            // textarea, so focus is lost after every answer and the student
            // cannot draft the next question while reading this one. Only a
            // spent allowance locks the composer.
            disabled={locked}
            aria-label="Your question"
          />
          <Button
            type="submit"
            size="icon-lg"
            disabled={
              streaming ||
              locked ||
              draft.trim().length < TUTOR_MIN_QUESTION_CHARS
            }
            aria-label="Send question"
          >
            <ArrowUp aria-hidden="true" />
          </Button>
        </form>

        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Study aid only — answers come from your course materials and are
            not clinical advice. Verify anything you rely on.
          </span>
        </p>
      </div>
    </div>
  );
}

function Thinking({ wakingUp }: { wakingUp: boolean }) {
  return (
    <div className="space-y-1.5" role="status">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="size-4 animate-pulse" aria-hidden="true" />
        Looking through your materials…
      </p>
      {wakingUp && (
        <p className="text-xs text-muted-foreground">
          The tutor is waking up — the first question after a quiet spell can
          take up to a minute.
        </p>
      )}
    </div>
  );
}

// Plausible for the current corpus (Merck Manual + Oxford Handbook of Clinical
// Surgery). Worth re-checking against the client's real materials: a starter
// the tutor refuses is a bad first impression of a deliberately strict tutor.
const STARTERS = [
  "Explain the mechanism of action of beta blockers",
  "What are the causes of hypokalaemia?",
  "Summarise the management of acute pancreatitis",
];

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-border px-5 py-8 text-center">
      <p className="text-sm text-muted-foreground">
        The tutor answers only from your course materials, and cites what it
        used. If a topic isn&apos;t covered, it will say so rather than guess.
      </p>
      <ul className="mt-4 flex flex-wrap justify-center gap-2">
        {STARTERS.map((s) => (
          <li key={s}>
            <Button variant="outline-muted" size="sm" onClick={() => onPick(s)}>
              {s}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
