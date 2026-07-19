"use client";

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type AnswerState = "idle" | "correct" | "incorrect" | "missed";

/**
 * A single answer choice. Large tap target for one-handed phone use.
 *
 * Colour is never the only signal: correct is teal + check, incorrect is
 * crimson + cross, so the two stay distinguishable without colour vision.
 */
export function AnswerOption({
  id,
  groupName,
  label,
  letter,
  selected,
  multi,
  state = "idle",
  disabled,
  onSelect,
}: {
  id: string;
  /** Radio group key — scope per question, never a global constant. */
  groupName: string;
  label: string;
  letter: string;
  selected: boolean;
  multi: boolean;
  state?: AnswerState;
  disabled?: boolean;
  onSelect?: (id: string) => void;
}) {
  const isCorrect = state === "correct";
  const isIncorrect = state === "incorrect";
  const isMissed = state === "missed";

  return (
    <label
      className={cn(
        "group relative flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
        "min-h-14 has-focus-visible:ring-3 has-focus-visible:ring-ring/40",
        !disabled && "hover:bg-accent/60",
        selected && state === "idle" && "border-primary bg-accent",
        state === "idle" && !selected && "border-border bg-card",
        isCorrect && "border-success bg-success/10",
        isIncorrect && "border-destructive bg-destructive/10",
        isMissed && "border-success/50 border-dashed bg-success/5",
        disabled && "cursor-default"
      )}
    >
      <input
        type={multi ? "checkbox" : "radio"}
        name={multi ? `${groupName}-${id}` : groupName}
        value={id}
        checked={selected}
        disabled={disabled}
        onChange={() => onSelect?.(id)}
        className="sr-only"
      />

      <span
        aria-hidden="true"
        className={cn(
          "flex size-7 shrink-0 items-center justify-center border text-xs font-semibold transition-colors",
          multi ? "rounded-md" : "rounded-full",
          selected && state === "idle" &&
            "border-primary bg-primary text-primary-foreground",
          !selected && state === "idle" &&
            "border-border text-muted-foreground group-hover:border-primary/50",
          isCorrect && "border-success bg-success text-success-foreground",
          isIncorrect &&
            "border-destructive bg-destructive text-destructive-foreground",
          isMissed && "border-success text-success"
        )}
      >
        {isCorrect || isMissed ? (
          <Check className="size-4" strokeWidth={3} />
        ) : isIncorrect ? (
          <X className="size-4" strokeWidth={3} />
        ) : (
          letter
        )}
      </span>

      <span className="pt-0.5 text-[0.95rem] leading-relaxed text-foreground">
        {label}
      </span>

      {isMissed && (
        <span className="ml-auto shrink-0 self-center text-xs font-medium text-success">
          Correct answer
        </span>
      )}
    </label>
  );
}
