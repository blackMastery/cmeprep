import { Stars } from "@/components/marketing/review-stars";
import { cn } from "@/lib/utils";

/**
 * The aggregate: a big number, a star bar and a count.
 *
 * The numerals and the bar are BOTH aria-hidden and one sr-only sentence
 * carries the whole thing, so a screen reader never hears a bare "4.6".
 * averageLabel is the single string that drives the digits, the bar's fill
 * and schema.org ratingValue.
 */
export function ReviewSummary({
  averageLabel,
  total,
  variant = "band",
  className,
}: {
  averageLabel: string;
  total: number;
  variant?: "band" | "page";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p
        aria-hidden="true"
        className={cn(
          "font-display font-bold tabular-nums text-primary",
          variant === "band" ? "text-5xl" : "text-4xl",
        )}
      >
        {averageLabel}
      </p>
      <Stars
        value={averageLabel}
        total={total}
        size={variant === "band" ? "md" : "sm"}
      />
      <p aria-hidden="true" className="text-sm text-muted-foreground">
        from {total} review{total === 1 ? "" : "s"}
      </p>
    </div>
  );
}
