"use client";

import type { RefObject } from "react";
import Link from "next/link";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Maximize2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Transcript } from "@/components/tutor/transcript";
import { Composer, Disclaimer } from "@/components/tutor/composer";
import {
  BlockedNotice,
  LoadErrorNotice,
  SignedOutNotice,
} from "@/components/tutor/notices";
import { useScrollPinning } from "@/components/tutor/use-scroll-pinning";
import {
  useTutorConversation,
  useTutorWidget,
} from "@/components/tutor/tutor-widget-provider";

/**
 * The popup's contents (SPEC §18) — header, scrolling transcript, composer.
 * Mounted inside whichever Radix content the breakpoint picked; the refs let
 * that wrapper decide what to focus on open.
 */
export function TutorPanel({
  composerRef,
  transcriptRef,
}: {
  composerRef: RefObject<HTMLTextAreaElement | null>;
  transcriptRef: RefObject<HTMLDivElement | null>;
}) {
  const { ask, newConversation, setDraft, loadState } = useTutorWidget();
  const s = useTutorConversation();
  useScrollPinning(transcriptRef, [s.turns, s.streaming]);

  const locked = s.blocked !== null || s.signedOut;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <DialogPrimitive.Title className="font-display text-base font-semibold tracking-tight">
          AI tutor
        </DialogPrimitive.Title>
        {s.left !== null && s.limit !== null && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {s.left} of {s.limit} left
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {s.turns.length > 0 && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={newConversation}
              disabled={s.streaming}
              aria-label="New conversation"
              title="New conversation"
            >
              <RotateCcw aria-hidden="true" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            asChild
            aria-label="Open full page"
            title="Open full page"
          >
            <Link href="/tutor">
              <Maximize2 aria-hidden="true" />
            </Link>
          </Button>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close">
              <X aria-hidden="true" />
            </Button>
          </DialogPrimitive.Close>
        </div>
      </header>

      <div
        ref={transcriptRef}
        // Focusable so the mobile sheet has somewhere safe to land focus
        // without raising the keyboard over the transcript.
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 outline-none"
      >
        {!s.loaded && s.loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading">
            <Skeleton className="ml-auto h-9 w-3/5 rounded-2xl" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <Transcript
            turns={s.turns}
            streaming={s.streaming}
            awaitingFirstToken={s.awaitingFirstToken}
            wakingUp={s.wakingUp}
            onPick={ask}
            compact
          />
        )}
      </div>

      <div className="space-y-2 border-t border-border bg-background px-4 pt-3 pb-[max(--spacing(3),env(safe-area-inset-bottom))]">
        {s.loadError && !s.loaded && (
          <LoadErrorNotice
            message={s.loadError}
            onRetry={() => loadState({ force: true })}
          />
        )}
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
          ready={s.loaded}
          textareaRef={composerRef}
          rows={1}
        />

        <Disclaimer />
      </div>
    </div>
  );
}
