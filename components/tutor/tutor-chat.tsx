"use client";

import { useEffect, useLayoutEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Transcript } from "@/components/tutor/transcript";
import { Composer, Disclaimer } from "@/components/tutor/composer";
import { BlockedNotice, SignedOutNotice } from "@/components/tutor/notices";
import { useScrollPinning } from "@/components/tutor/use-scroll-pinning";
import {
  useTutorConversation,
  useTutorWidget,
} from "@/components/tutor/tutor-widget-provider";
import { turnsFromHistory, type TutorStatePayload } from "@/lib/tutor-core";

/** Layout effect on the client, plain effect during SSR — see
 * use-scroll-pinning.ts for why the swap is real. */
const useBeforePaint =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The /tutor page: the maximised view of the ONE conversation store the
 * floating widget also renders (SPEC §18).
 *
 * The server snapshot is rendered directly until the store has adopted it —
 * so the transcript is in the server HTML and hydration shows no empty-state
 * flash — and adopted before paint. The store wins once loaded: it may be
 * mid-stream from the widget, in which case the snapshot holds the question
 * without its answer and `seed` declines it.
 */
export function TutorChat({ initial }: { initial: TutorStatePayload }) {
  const { seed, ask, newConversation, setDraft } = useTutorWidget();
  const s = useTutorConversation();

  useBeforePaint(() => {
    seed(initial);
  }, [seed, initial]);

  const turns = s.loaded ? s.turns : turnsFromHistory(initial.turns);
  const left = s.loaded
    ? s.left
    : initial.verdict.allowed
      ? initial.verdict.remaining
      : null;
  const limit = s.loaded
    ? s.limit
    : initial.verdict.allowed
      ? initial.verdict.limit
      : null;

  useScrollPinning(null, [turns, s.streaming]);

  const locked = s.blocked !== null || s.signedOut;

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
              disabled={s.streaming}
            >
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
              New conversation
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1">
        <Transcript
          turns={turns}
          streaming={s.streaming}
          awaitingFirstToken={s.awaitingFirstToken}
          wakingUp={s.wakingUp}
          onPick={ask}
        />
      </div>

      <div className="sticky bottom-0 mt-6 space-y-2 bg-background pt-3 pb-4">
        {s.blocked && <BlockedNotice blocked={s.blocked} />}
        {s.signedOut && <SignedOutNotice />}

        {s.retry && !s.streaming && !locked && (
          <Button variant="outline" size="sm" onClick={() => ask(s.retry!)}>
            Retry that question
          </Button>
        )}

        <Composer
          draft={s.draft}
          onDraftChange={setDraft}
          onSend={ask}
          streaming={s.streaming}
          locked={locked}
        />

        <Disclaimer />
      </div>
    </div>
  );
}
