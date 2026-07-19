"use client";

import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";

export type PaletteEntry = {
  index: number;
  answered: boolean;
  flagged: boolean;
};

export function QuestionPalette({
  entries,
  current,
  onJump,
}: {
  entries: PaletteEntry[];
  current: number;
  onJump: (index: number) => void;
}) {
  const answered = entries.filter((e) => e.answered).length;
  const flagged = entries.filter((e) => e.flagged).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground">{answered}</span> of{" "}
          {entries.length} answered
        </span>
        {flagged > 0 && (
          <span className="flex items-center gap-1">
            <Flag className="size-3" aria-hidden="true" />
            {flagged} flagged
          </span>
        )}
      </div>

      <div className="grid grid-cols-6 gap-2 sm:grid-cols-8 lg:grid-cols-5">
        {entries.map((entry) => {
          const isCurrent = entry.index === current;
          return (
            <button
              key={entry.index}
              type="button"
              onClick={() => onJump(entry.index)}
              aria-label={`Question ${entry.index + 1}${
                entry.answered ? ", answered" : ", not answered"
              }${entry.flagged ? ", flagged" : ""}`}
              aria-current={isCurrent ? "true" : undefined}
              className={cn(
                "relative flex aspect-square items-center justify-center rounded-lg border text-sm font-medium tabular-nums transition-colors",
                "focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
                isCurrent && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                entry.answered
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/50"
              )}
            >
              {entry.index + 1}
              {entry.flagged && (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-foreground text-background"
                >
                  <Flag className="size-2" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <dl className="space-y-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="size-3 rounded-sm bg-primary" aria-hidden="true" />
          <dt>Answered</dt>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="size-3 rounded-sm border border-border bg-card"
            aria-hidden="true"
          />
          <dt>Not answered</dt>
        </div>
      </dl>
    </div>
  );
}
