import { Star } from "lucide-react";
import { WriteReviewDialog } from "@/components/site-review-form";

/**
 * "Enjoying this? Leave a review" after a strong score.
 *
 * Deliberately much lighter than TrialResultsUpsell above it — a single
 * bordered row, not a filled Card — because it must not compete with
 * "Review N wrong answers", which is the actually useful next step on this
 * page. The caller decides whether to render this at all
 * (shouldPromptForReview), including standing down when the upsell shows.
 */
export function ReviewResultsPrompt({
  userId,
  displayName,
}: {
  userId: string;
  displayName: string;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm">
      <Star className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        Good result. Would you tell other students what studying here is like?
      </p>
      <WriteReviewDialog userId={userId} displayName={displayName} />
    </div>
  );
}
