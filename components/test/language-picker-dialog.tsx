"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { requestLanguage } from "@/app/(app)/profile/actions";
import { cn } from "@/lib/utils";
import {
  enabledRegistry,
  requestableLanguages,
  translatedAttrs,
} from "@/lib/translation-ui-core";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NATIVE_SELECT_CLASS } from "@/components/language-select";

/**
 * The first-click language picker: opens when Translate is pressed on a
 * paper that has no language and the profile has no default. One tap picks
 * — the choice is saved to both and the translation starts. Mid-exam the
 * clock keeps running, so there is nothing else to fill in.
 */
export function LanguagePickerDialog({
  open,
  onOpenChange,
  enabledLanguageCodes,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enabledLanguageCodes: readonly string[];
  onPick: (code: string) => void;
}) {
  const languages = enabledRegistry(enabledLanguageCodes);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Translate to…</DialogTitle>
          <DialogDescription>
            The exam is in English. Pick the language you&apos;d like AI
            translations in — it&apos;s saved to your profile and to this test.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {languages.map((l) => {
            const attrs = translatedAttrs(l.code);
            return (
              <button
                key={l.code}
                type="button"
                onClick={() => onPick(l.code)}
                className={cn(
                  "flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 text-left transition-colors",
                  "hover:border-primary/50 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
                )}
              >
                <span className="font-medium" {...attrs}>
                  {l.nativeName}
                </span>
                <span className="text-xs text-muted-foreground">{l.name}</span>
              </button>
            );
          })}
        </div>

        <RequestLanguage enabledLanguageCodes={enabledLanguageCodes} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Don't see your language?" — a registry language that isn't switched on
 * yet. One request per account per language server-side; the admin page
 * shows the counts. Shared by the picker and the profile card.
 */
export function RequestLanguage({
  enabledLanguageCodes,
  className,
}: {
  enabledLanguageCodes: readonly string[];
  className?: string;
}) {
  const options = requestableLanguages(enabledLanguageCodes);
  const [code, setCode] = useState(options[0]?.code ?? "");
  const [pending, startTransition] = useTransition();
  if (options.length === 0) return null;

  const send = () =>
    startTransition(async () => {
      const { ok, error } = await requestLanguage(code);
      if (ok) toast.success("Request noted — thanks.");
      else toast.error(error ?? "Could not send the request.");
    });

  return (
    <details className={cn("text-sm", className)}>
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        Don&apos;t see your language?
      </summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-label="Language to request"
          className={cn(NATIVE_SELECT_CLASS, "h-9 w-auto max-w-full px-2")}
        >
          {options.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name} · {l.nativeName}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline-muted"
          size="sm"
          onClick={send}
          disabled={pending}
        >
          {pending ? "Sending…" : "Request"}
        </Button>
      </div>
    </details>
  );
}
