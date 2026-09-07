import { Star } from "lucide-react";
import { REVIEW_RATING_MAX, starLabel } from "@/lib/site-reviews-core";
import { cn } from "@/lib/utils";

/**
 * A star rating, readable at a glance and correct to a screen reader.
 *
 * The fill is a second, absolutely-positioned row of filled stars clipped to
 * a percentage width, so a fractional average (4.6 -> 92%) renders exactly
 * with one icon asset and no half-star sprite. The percentage comes from the
 * SAME string the page prints and the JSON-LD serialises, so the graphic can
 * never disagree with the digits.
 *
 * The whole bar is aria-hidden, not just the icons: hiding only the icons
 * leaves assistive tech reading five "star" graphics before it reaches the
 * label. One sr-only sentence is the entire accessible name.
 */
export function Stars({
  value,
  total,
  size = "md",
  className,
}: {
  /** "4.6" for an aggregate, or an integer for one review. */
  value: number | string;
  /** Included in the spoken label when this is an aggregate. */
  total?: number;
  size?: "sm" | "md";
  className?: string;
}) {
  const numeric = typeof value === "string" ? Number(value) : value;
  const pct = Math.max(0, Math.min(100, (numeric / REVIEW_RATING_MAX) * 100));

  // Crimson on cream. Gold is reserved for crimson bands, and nothing renders
  // stars on one — add the variant when something actually does, rather than
  // shipping an unrendered branch that claims to encode the token rule.
  const iconSize = size === "sm" ? "size-4" : "size-5";
  const empty = "text-primary/25";
  const filled = "text-primary";

  return (
    <span className={cn("inline-flex items-center", className)}>
      <span
        aria-hidden="true"
        className="relative inline-flex shrink-0 align-middle"
      >
        <span className={cn("flex", empty)}>
          {Array.from({ length: REVIEW_RATING_MAX }, (_, i) => (
            <Star key={i} className={iconSize} />
          ))}
        </span>
        <span
          className="absolute inset-y-0 left-0 overflow-hidden"
          style={{ width: `${pct}%` }}
        >
          <span className={cn("flex", filled)}>
            {Array.from({ length: REVIEW_RATING_MAX }, (_, i) => (
              <Star key={i} className={cn(iconSize, "fill-current")} />
            ))}
          </span>
        </span>
      </span>
      <span className="sr-only">{starLabel(value, total)}</span>
    </span>
  );
}
