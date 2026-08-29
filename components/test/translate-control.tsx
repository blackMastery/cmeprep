"use client";

import { Languages, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  translateButtonLabel,
  translateButtonParts,
  translatedAttrs,
} from "@/lib/translation-ui-core";
import { Button } from "@/components/ui/button";
import type { TranslationApi } from "@/components/test/use-question-translation";

/**
 * The per-question Translate control: one button that is, by turns, the
 * request, the spinner, the retry and the shown/original toggle — the same
 * element throughout, so keyboard focus survives the wait and the swap.
 * When a translation is on screen, an "AI translation" chip sits beside the
 * toggle; the chip is a label (blush), not a warning — the warning is the
 * one-time notice. The live region is NOT here: the hook's owner renders
 * one (TranslationChrome), so review's many controls announce once.
 *
 * With the feature off (no languages, or the paper's language switched off
 * under the student) nothing renders EXCEPT the toggle for a question that
 * already has a translation — a student is never stranded in a language.
 */
export function TranslateControl({
  api,
  questionId,
  className,
}: {
  api: TranslationApi;
  questionId: string;
  className?: string;
}) {
  const status = api.statusFor(questionId);
  const shown = status === "shown";
  const isToggle = shown || status === "original";
  if (!api.enabled && !isToggle) return null;

  const pending = status === "pending";
  const label = translateButtonLabel(api.language, status);
  const { prefix, name } = translateButtonParts(api.language, status);
  // The cap blocks every fresh request — the retry included.
  const blockedByCap = api.capped && (status === "idle" || status === "error");

  return (
    <span className={cn("flex items-center gap-2", className)}>
      {shown && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground"
          title="Machine-translated by AI — may contain errors"
        >
          <Languages className="size-3" aria-hidden="true" />
          AI translation
          <span className="sr-only">, machine translated, may contain errors</span>
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() =>
          isToggle ? api.toggle(questionId) : api.translate(questionId)
        }
        disabled={pending || blockedByCap}
        aria-busy={pending}
        aria-pressed={isToggle ? shown : undefined}
        aria-label={label}
        title={
          isToggle
            ? `${label} (T)`
            : blockedByCap
              ? "Translation limit reached for today"
              : label
        }
      >
        {pending ? (
          <Loader2 className="animate-spin" data-icon="inline-start" />
        ) : (
          <Languages data-icon="inline-start" />
        )}
        {/* Phones get the verb only; the full label stays in aria-label. The
            native name carries its own lang/dir so "Show العربية" reads and
            isolates correctly inside the English button. */}
        {isToggle || pending ? (
          <>
            {prefix}
            {name && <span {...translatedAttrs(api.language)}>{name}</span>}
          </>
        ) : (
          <>
            <span className="sm:hidden">
              {status === "error" ? "Retry" : "Translate"}
            </span>
            <span className="hidden sm:inline">
              {prefix}
              {name && <span {...translatedAttrs(api.language)}>{name}</span>}
            </span>
          </>
        )}
      </Button>
    </span>
  );
}
