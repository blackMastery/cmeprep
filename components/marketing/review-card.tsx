import { BadgeCheck } from "lucide-react";
import type { PublicReview } from "@/lib/site-reviews";
import { Badge } from "@/components/ui/badge";
import { Stars } from "@/components/marketing/review-stars";
import { cn } from "@/lib/utils";

/**
 * One published review.
 *
 * There is deliberately NO avatar. There is no avatar column and no avatars
 * bucket, and lib/marketing-images.ts records that the Unsplash licence
 * grants no model release — so a stock face beside a real person's words
 * would be a misrepresentation, not a design flourish.
 *
 * The date is not optional either: undated testimonials read as fake, and it
 * has to match datePublished in the JSON-LD on /reviews.
 */

const monthFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  year: "numeric",
  // UTC so the visible month always equals the JSON-LD's datePublished.
  timeZone: "UTC",
});

export function ReviewCard({
  review,
  variant = "full",
  clamp = false,
}: {
  review: PublicReview;
  /** `compact` drops the card chrome for the pricing rail. */
  variant?: "full" | "compact";
  /** Clamps the body — the marketing band; /reviews shows it whole. */
  clamp?: boolean;
}) {
  return (
    <article
      id={`review-${review.id}`}
      className={cn(
        "flex h-full scroll-mt-20 flex-col",
        variant === "full" &&
          "rounded-2xl bg-card p-6 ring-1 ring-foreground/10",
      )}
    >
      <Stars value={review.rating} size="sm" />

      {/* whitespace-pre-line keeps the author's paragraph breaks; break-words
          stops a 1000-character unbroken token blowing out the grid. Plain
          text, React-escaped — never dangerouslySetInnerHTML, never markdown. */}
      <p
        className={cn(
          "mt-3 whitespace-pre-line break-words text-[15px] leading-relaxed",
          clamp && (variant === "compact" ? "line-clamp-4" : "line-clamp-6"),
        )}
      >
        {review.body}
      </p>

      <footer className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-sm">
        <cite className="font-medium not-italic">{review.displayName}</cite>
        {review.verifiedPurchase && (
          <Badge variant="secondary" className="gap-1">
            <BadgeCheck className="size-3.5" aria-hidden="true" />
            Verified purchase
          </Badge>
        )}
        <time
          dateTime={review.createdAt}
          className="ml-auto text-xs text-muted-foreground"
        >
          {monthFormatter.format(new Date(review.createdAt))}
        </time>
      </footer>
    </article>
  );
}
