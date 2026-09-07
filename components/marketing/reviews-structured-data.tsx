import { absoluteUrl } from "@/lib/site";
import type { PublicReview } from "@/lib/site-reviews";
import {
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  reviewsArePublic,
} from "@/lib/site-reviews-core";
import {
  JsonLd,
  organizationNode,
  programNode,
  type MarkupLanguage,
} from "@/components/marketing/structured-data";

/**
 * Schema.org review markup for the FIRST PAGE of /reviews, and nowhere else.
 *
 * The home page shows a hand-picked handful of quotes, so an aggregateRating
 * over every approved review would be a claim that page does not evidence,
 * and markup disagreeing with the visible page is a manual-action risk (the
 * reasoning MarketingStructuredData already states about Product/Offer).
 *
 * Page 1 only, because /reviews paginates. `reviewCount` is legitimately the
 * total — that is what aggregateRating means, and `review[]` is a sample —
 * but every paginated page declares canonical "/reviews", so emitting the
 * same aggregate on ?page=2 with a different twelve bodies would hand
 * crawlers two conflicting descriptions of one canonical URL. One page, one
 * block, one sample.
 *
 * This component NEVER queries. The page does one read and hands the same
 * object to both this and the visible summary — that is the entire reason
 * the markup and the content cannot diverge. Do not "optimise" it into
 * fetching its own data.
 *
 * Worth knowing before editing: EducationalOccupationalProgram is not one of
 * Google's review-snippet-eligible types, and self-serving reviews of your
 * own service are ineligible anyway — so this probably will not draw stars in
 * search. It is here to describe the page truthfully. Do NOT "fix" that by
 * adding a Product/Offer node; that is exactly the risk the sibling file
 * refuses to take.
 */
export function ReviewsStructuredData({
  reviews,
  total,
  averageLabel,
  page,
  languages = [],
}: {
  /** The reviews this page is rendering, and nothing else. */
  reviews: PublicReview[];
  /** Approved reviews in total — the same number the page prints. */
  total: number;
  /** The displayed average. Null below the gate. */
  averageLabel: string | null;
  /** 1-based. Only page 1 emits markup; see the note above. */
  page: number;
  languages?: MarkupLanguage[];
}) {
  // Guarded here rather than only at the call site, so no future caller can
  // emit an aggregate the page does not show, or duplicate this block across
  // paginated URLs that all claim the same canonical.
  if (page !== 1) return null;
  if (!reviewsArePublic(total) || averageLabel === null) return null;
  if (reviews.length === 0) return null;

  const program = {
    ...programNode(),
    aggregateRating: {
      "@type": "AggregateRating",
      // The DISPLAYED string, never the raw float: the number in the markup
      // has to be the number on the page, character for character.
      ratingValue: averageLabel,
      reviewCount: total,
      bestRating: REVIEW_RATING_MAX,
      worstRating: REVIEW_RATING_MIN,
    },
    review: reviews.map((review) => ({
      "@type": "Review",
      // Matches the DOM anchor on the corresponding <article>, so the markup
      // and the page address the same thing and deep links work.
      "@id": absoluteUrl(`/reviews#review-${review.id}`),
      itemReviewed: { "@id": absoluteUrl("/#program") },
      reviewRating: {
        "@type": "Rating",
        ratingValue: review.rating,
        bestRating: REVIEW_RATING_MAX,
        worstRating: REVIEW_RATING_MIN,
      },
      author: { "@type": "Person", name: review.displayName },
      reviewBody: review.body,
      datePublished: review.createdAt.slice(0, 10),
    })),
  };

  // Rendered through the shared emitter so the </script> escaping lives in
  // one place rather than on whichever component happened to need it first.
  return <JsonLd graph={[organizationNode(languages), program]} />;
}
