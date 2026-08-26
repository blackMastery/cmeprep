"use client";

import type { RefObject } from "react";
import { ArrowUp, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TUTOR_MIN_QUESTION_CHARS } from "@/lib/tutor-core";

/** The question box — shared by the /tutor page and the widget panel. */
export function Composer({
  draft,
  onDraftChange,
  onSend,
  streaming,
  locked,
  ready = true,
  textareaRef,
  rows = 2,
}: {
  draft: string;
  onDraftChange: (draft: string) => void;
  onSend: (question: string) => void;
  streaming: boolean;
  /** A spent allowance (or a dead session). Disables the textarea too. */
  locked: boolean;
  /** The verdict is known. Until then only SENDING is held back, so the
   * student can draft while the panel loads. */
  ready?: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  rows?: number;
}) {
  const canSend =
    ready &&
    !streaming &&
    !locked &&
    draft.trim().length >= TUTOR_MIN_QUESTION_CHARS;

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend(draft);
      }}
    >
      <Textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
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
            if (canSend) onSend(draft);
          }
        }}
        placeholder="Ask about anything in your study materials…"
        rows={rows}
        className={
          rows === 1
            ? "min-h-11 resize-none rounded-2xl"
            : "min-h-[3.25rem] resize-none rounded-2xl"
        }
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
        disabled={!canSend}
        aria-label="Send question"
      >
        <ArrowUp aria-hidden="true" />
      </Button>
    </form>
  );
}

export function Disclaimer() {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>
        Study aid only — answers come from your course materials and are not
        clinical advice. Verify anything you rely on.
      </span>
    </p>
  );
}
