"use client";

import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TranslationApi } from "@/components/test/use-question-translation";

/**
 * The one-time caution, shown the first time a translation is on screen in
 * a test and remembered per test once dismissed. Sun (caution), per the
 * brand rule — never gold. The icon is text-foreground rather than the org
 * banner's text-ink: ink is invisible on the dark theme's sun/15 ground.
 */
export function TranslationNotice({ api }: { api: TranslationApi }) {
  if (!api.notice.visible) return null;
  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-xl border border-sun/60 bg-sun/15 px-4 py-3 text-sm"
    >
      <AlertTriangle
        className="mt-0.5 size-4 shrink-0 text-foreground"
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1">
        The exam is in English; translations are AI-generated and may contain
        errors. Use &ldquo;Show original&rdquo; to check the source text.
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss"
        onClick={api.notice.dismiss}
      >
        <X />
      </Button>
    </div>
  );
}
