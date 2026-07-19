import { AlertCircle, Check, Loader2 } from "lucide-react";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Pure presentational component — the parent owns the state machine and is
 * responsible for dropping "saved" back to "idle" after a moment. Keeping the
 * timer here would mean setting state synchronously inside an effect on every
 * save, which cascades an extra render.
 */
export function AutosaveIndicator({ state }: { state: SaveState }) {
  if (state === "error") {
    return (
      <span
        className="flex items-center gap-1.5 text-xs text-destructive"
        role="status"
      >
        <AlertCircle className="size-3.5" aria-hidden="true" />
        Not saved — retrying
      </span>
    );
  }

  if (state === "saving") {
    return (
      <span
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
        role="status"
      >
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Saving…
      </span>
    );
  }

  if (state === "saved") {
    return (
      <span
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
        role="status"
      >
        <Check className="size-3.5 text-success" aria-hidden="true" />
        Saved just now
      </span>
    );
  }

  return null;
}
