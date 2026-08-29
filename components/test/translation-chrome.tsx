"use client";

import { LanguagePickerDialog } from "@/components/test/language-picker-dialog";
import type { TranslationApi } from "@/components/test/use-question-translation";

/**
 * What every owner of useQuestionTranslation mounts exactly once: the
 * first-click language picker and the ONE sr-only live region. Per-control
 * live regions would announce a single event as many times as there are
 * controls on screen (review has one per card); a zero-width toggle on the
 * nonce lets an identical consecutive message ("Showing original" on two
 * cards) announce again.
 */
export function TranslationChrome({ api }: { api: TranslationApi }) {
  return (
    <>
      <LanguagePickerDialog
        open={api.picker.open}
        onOpenChange={(open) => {
          if (!open) api.picker.close();
        }}
        enabledLanguageCodes={api.enabledLanguageCodes}
        onPick={api.picker.pick}
      />
      <span role="status" aria-live="polite" className="sr-only">
        {api.announcement.text}
        {api.announcement.nonce % 2 === 1 ? "\u200b" : ""}
      </span>
    </>
  );
}
