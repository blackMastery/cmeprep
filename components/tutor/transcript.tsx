"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { CitationList } from "@/components/tutor/citation-list";
import { FeedbackButtons } from "@/components/tutor/feedback-buttons";
import type { TranscriptTurn } from "@/lib/tutor-core";

/** The conversation itself — shared by the /tutor page and the widget panel. */
export function Transcript({
  turns,
  streaming,
  awaitingFirstToken,
  wakingUp,
  onPick,
  compact = false,
}: {
  turns: TranscriptTurn[];
  streaming: boolean;
  awaitingFirstToken: boolean;
  wakingUp: boolean;
  onPick: (question: string) => void;
  /** Tighter rhythm for the panel. */
  compact?: boolean;
}) {
  return (
    <div className={compact ? "space-y-4" : "space-y-6"}>
      {turns.length === 0 && !streaming && (
        <EmptyState onPick={onPick} compact={compact} />
      )}

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
            {turn.messageId && <FeedbackButtons messageId={turn.messageId} />}
          </div>
        )
      )}

      {/* Only until the first token lands. Leaving it under a streaming
          answer both lies ("looking through your materials" while it is
          plainly answering) and reserves space that collapses when the
          stream ends, shifting everything one last time. */}
      {streaming && awaitingFirstToken && <Thinking wakingUp={wakingUp} />}
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

function EmptyState({
  onPick,
  compact,
}: {
  onPick: (q: string) => void;
  compact: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "rounded-2xl border border-dashed border-border px-4 py-6 text-center"
          : "rounded-2xl border border-dashed border-border px-5 py-8 text-center"
      }
    >
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
