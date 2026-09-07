import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { SiteReviewForm } from "@/components/site-review-form";

/**
 * "Write a review" on the profile page — the entry point that is always
 * there and never interrupts anything, which is what makes the other two
 * (the results prompt and the dashboard banner) safe to keep quiet.
 *
 * Named site-review-card to stay clear of the marketing review-card, which
 * renders a published review rather than collecting one.
 */
export function SiteReviewCard({
  userId,
  displayName,
  hasReviewed,
}: {
  userId: string;
  /** The exact string that would be published, so the consent box can show
   * it. Computed server-side with reviewDisplayName(). */
  displayName: string;
  hasReviewed: boolean;
}) {
  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-5">
        <div>
          <h2 className="font-display text-lg">Write a review</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasReviewed
              ? "Thanks — you've already reviewed cmeqbank.com."
              : "Tell other doctors and students what preparing here was actually like. Reviews are checked before they go up."}
          </p>
        </div>

        {hasReviewed ? (
          <p className="text-sm">
            <Link
              href="/reviews"
              className="text-primary underline underline-offset-2"
            >
              Read what everyone else said
            </Link>
          </p>
        ) : (
          <SiteReviewForm userId={userId} displayName={displayName} />
        )}
      </CardContent>
    </Card>
  );
}
