"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { LanguageState } from "@/lib/admin/translations";
import { setLanguageEnabledAction } from "@/app/admin/translations/actions";
import { languageByCode } from "@/lib/translation-core";
import { translatedAttrs } from "@/lib/translation-ui-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Every registry language with its toggle, cache size and request count.
 * Toggles are optimistic (bookmark-toggle precedent) and revert with a toast
 * on failure. Disabling a language with cached rows asks first: students
 * whose paper is frozen to it lose the Translate button (the cache stays).
 */
export function TranslationLanguagesCard({
  languages,
}: {
  languages: LanguageState[];
}) {
  return (
    <Card className="[--card-spacing:--spacing(4)]">
      <CardContent>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg">Languages</h2>
          <p className="text-xs text-muted-foreground">
            Only enabled languages appear in the student picker. Requests are
            students who asked for a language that is off.
          </p>
        </div>
        <ul className="divide-y divide-border">
          {languages.map((l) => (
            <LanguageRow key={l.code} state={l} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function LanguageRow({ state }: { state: LanguageState }) {
  const meta = languageByCode(state.code);
  const name = meta?.name ?? state.code;
  const [enabled, setEnabled] = useState(state.enabled);
  const [confirming, setConfirming] = useState(false);
  const [, startTransition] = useTransition();
  const attrs = translatedAttrs(state.code);

  const apply = (next: boolean) => {
    setEnabled(next);
    startTransition(async () => {
      const { ok, error } = await setLanguageEnabledAction(state.code, next);
      if (!ok) {
        setEnabled(!next);
        toast.error(error ?? "Could not update the language.");
      }
    });
  };

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="font-medium" {...attrs}>
          {meta?.nativeName ?? state.code}
        </span>
        <span className="text-xs text-muted-foreground">
          {name} · {state.code}
          {meta?.dir === "rtl" && " · RTL"}
        </span>
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {state.cached} cached
      </span>
      {!enabled && state.requests > 0 && (
        <Badge variant="secondary">
          {state.requests} request{state.requests === 1 ? "" : "s"}
        </Badge>
      )}
      <label className="flex items-center gap-2">
        <Checkbox
          checked={enabled}
          onCheckedChange={(v) => {
            const next = v === true;
            // Turning OFF a language with cached rows is the consequential
            // direction — confirm it; everything else applies at once.
            if (!next && state.cached > 0) setConfirming(true);
            else apply(next);
          }}
          aria-label={`${enabled ? "Disable" : "Enable"} ${name}`}
        />
        <span className="text-xs">{enabled ? "Enabled" : "Off"}</span>
      </label>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              Turn off {name}?
            </DialogTitle>
            <DialogDescription>
              Students with tests in {name} lose the Translate button; the{" "}
              {state.cached} cached translation{state.cached === 1 ? "" : "s"}{" "}
              stay for when it is turned back on.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <DialogClose asChild>
              <Button variant="outline-muted">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                apply(false);
              }}
            >
              Turn off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
