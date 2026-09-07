import type { SiteReviewStatus } from "@/lib/supabase/types";

/**
 * Pure rules for product reviews. The DB work lives in lib/site-reviews.ts
 * (student side) and lib/admin/site-reviews.ts (moderation side); every rule
 * they apply is stated here once so vitest can cover it.
 *
 * This module is also what the CLIENT components import — the form, the star
 * picker and the dashboard banner. lib/site-reviews.ts is `server-only`, so
 * anything they need (the length cap, the banner key, the display name they
 * are about to consent to publishing) has to live here.
 */

export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;

/** Restated in the site_reviews CHECK as a backstop; the human-readable
 * message comes from reviewBodyIssue() so client and server never disagree. */
export const REVIEW_BODY_MIN = 40;
export const REVIEW_BODY_MAX = 1000;

export const REVIEW_DISPLAY_NAME_MAX = 80;

/**
 * How many APPROVED reviews it takes before anything is shown publicly:
 * the marketing band, the /reviews list and the aggregateRating markup.
 * Counted over approved rows, featured or not.
 *
 * One, deliberately — the first published review goes straight up rather than
 * waiting for a quorum. The trade-off that buys is a real one: aggregateRating
 * then states an average over a single rating ("5.0 from 1 review"), which is
 * honest but thin, and a first review that is later rejected takes the whole
 * band and the markup down with it. Raising this back to 5 is a one-line
 * change here, and every gate follows.
 */
export const REVIEWS_PUBLIC_MIN = 1;

/** Pull-quotes per surface. The two must not overlap on one page — see
 * splitFeatured(). */
export const HOME_FEATURED = 3;
export const PRICING_FEATURED = 3;

/** /reviews page size. */
export const REVIEWS_PAGE_SIZE = 12;

export const REVIEW_STATUSES: readonly SiteReviewStatus[] = [
  "pending",
  "approved",
  "rejected",
];

export const REVIEW_STATUS_LABELS: Record<SiteReviewStatus, string> = {
  pending: "Waiting",
  approved: "Published",
  rejected: "Rejected",
};

/** Shown when profiles.full_name is null or blank — email signups can have
 * none. The form renders this exact string beside the consent box, because a
 * licence to publish a name you were never shown is not informed consent. */
export const REVIEW_FALLBACK_NAME = "A cmeqbank.com member";

/**
 * The one statement of the body rule. Returns the exact message a human sees,
 * or null when the body is acceptable. The form's live validation and the zod
 * schema both call it, so the client and the server can never disagree about
 * what "too short" means. Length is counted AFTER trimming.
 */
export function reviewBodyIssue(body: string): string | null {
  // Measures EXACTLY what will be stored, and in the units Postgres uses.
  //
  // Two bugs this prevents, both of which showed up as an opaque 500 that
  // discarded the review (the CHECK fires 23514, which the insert's 23505
  // branch does not catch):
  //  - normalize collapses blank-line runs, so a body validated raw could
  //    shrink below the minimum on its way into the column;
  //  - String.length counts UTF-16 units while char_length() counts code
  //    points, so 20 emoji measured 40 here and 20 in the CHECK.
  const length = reviewBodyLength(body);
  if (length === 0) return "Write a few words about your experience.";
  if (length < REVIEW_BODY_MIN) {
    return `Tell us a bit more — at least ${REVIEW_BODY_MIN} characters.`;
  }
  if (length > REVIEW_BODY_MAX) {
    return `Keep it under ${REVIEW_BODY_MAX} characters.`;
  }
  return null;
}

/** Length of the stored form, in code points — the same unit as the DB's
 * char_length(). The form's counter uses this too, so what a user is told
 * they have left is what the column will actually measure. */
export function reviewBodyLength(body: string): number {
  return [...normalizeReviewBody(body)].length;
}

/**
 * Collapses runs of blank lines at WRITE time, so a body of forty newlines
 * cannot stretch a marketing card once it renders under white-space:pre-line.
 * Paragraph breaks the author actually meant are preserved.
 */
export function normalizeReviewBody(body: string): string {
  return body
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * The name we will publish. Trimmed, internal whitespace collapsed, capped
 * without leaving a dangling space, with a fallback for a missing full_name.
 *
 * If you would rather publish "Anita P." than the full name, this is the only
 * place that decides it.
 */
export function reviewDisplayName(fullName: string | null): string {
  const cleaned = (fullName ?? "").trim().replace(/\s+/g, " ");
  if (cleaned.length === 0) return REVIEW_FALLBACK_NAME;
  // Sliced by code point, not by UTF-16 unit: String.slice can cut an
  // astral character in half and send a lone surrogate to Postgres, and the
  // column's char_length CHECK counts code points anyway.
  const points = [...cleaned];
  if (points.length <= REVIEW_DISPLAY_NAME_MAX) return cleaned;
  return points.slice(0, REVIEW_DISPLAY_NAME_MAX).join("").trimEnd();
}

/** Payment states where the money actually landed and stayed. Mirrors the
 * filter opsAlertCounts already applies — a denied, reversed or fully
 * refunded order is not a purchase, and the row survives the refund. */
export const VERIFIED_PAYMENT_STATUSES = [
  "captured",
  "partially_refunded",
] as const;

/**
 * "Has this person paid us", frozen onto the row at submit time.
 *
 * Deliberately NOT canAccessExam(): that is time-sensitive, so a badge
 * derived from it would quietly vanish the day a subscription lapsed.
 *
 * The caller MUST have filtered payments to VERIFIED_PAYMENT_STATUSES.
 * Counting every payments row instead put a permanent public "Verified
 * purchase" badge on chargebacks and declined orders, which no admin action
 * can remove — there is no edit action, by design.
 *
 * A personal subscription row still counts on its own, so an admin comp
 * grant is treated as verified. An ORG SEAT IS NOT: the payments row for an
 * org purchase belongs to the org admin who checked out, not to the seat
 * holder, so an enterprise member is published without the badge.
 */
export function verifiedPurchase(input: {
  subscriptions: number;
  payments: number;
}): boolean {
  return input.subscriptions > 0 || input.payments > 0;
}

export type ReviewEligibility =
  { ok: true } | { ok: false; reason: "banned" | "already_reviewed" };

/**
 * Who may leave a review: ANY signed-in, non-banned user, trial included.
 *
 * This function does not look at role, and that absence IS the decision —
 * eligibility was deliberately opened up from "verified purchaser". Being
 * signed in at all is the route's 401, not this. One review per account ever,
 * rejected ones included: re-submitting past a rejection is the abuse the
 * unique index prevents.
 */
export function reviewEligibility(input: {
  bannedAt: string | null;
  alreadyReviewed: boolean;
}): ReviewEligibility {
  if (input.bannedAt) return { ok: false, reason: "banned" };
  if (input.alreadyReviewed) return { ok: false, reason: "already_reviewed" };
  return { ok: true };
}

export type RatingCount = { rating: number; reviews: number };

export type ReviewSummary = {
  /** Approved reviews, featured or not. */
  count: number;
  /**
   * The DISPLAYED value: one decimal, half-up, always with the decimal
   * ("5.0", never "5"). Null when count is 0 — nothing may render "0.0".
   *
   * The ONLY representation of the average, deliberately. It drives the
   * visible number, the star bar's fill width AND schema.org ratingValue;
   * a second, separately-rounded copy is how you end up rendering five full
   * stars beside the text "4.8", and markup that disagrees with the visible
   * page is a manual-action risk (the reasoning MarketingStructuredData
   * already states).
   */
  averageLabel: string | null;
};

/**
 * Folds the site_review_rating_counts() histogram into the summary the public
 * surfaces render.
 *
 * averageLabel is computed from the INTEGER sum and count rather than from a
 * float mean: re-multiplying a float by 10 reintroduces the representation
 * error the integer form avoids. Math.round is half-up toward +Infinity,
 * which is what we want for positive ratings (4.75 -> "4.8", not "4.7").
 */
export function ratingCountsToSummary(
  rows: readonly RatingCount[],
): ReviewSummary {
  let sum = 0;
  let count = 0;

  for (const row of rows) {
    // The column is `rating int` with a 1-5 CHECK and `reviews` is a
    // count(*) off a GROUP BY, so these cannot fire — but a mapper must never
    // let a bad row into the denominator of a number we publish.
    if (!Number.isInteger(row.rating)) continue;
    if (row.rating < REVIEW_RATING_MIN || row.rating > REVIEW_RATING_MAX) {
      continue;
    }
    const reviews = Number.isFinite(row.reviews) ? Math.trunc(row.reviews) : 0;
    if (reviews <= 0) continue;
    sum += row.rating * reviews;
    count += reviews;
  }

  return {
    count,
    averageLabel:
      count === 0 ? null : (Math.round((sum * 10) / count) / 10).toFixed(1),
  };
}

/** The cold-start gate. */
export function reviewsArePublic(count: number): boolean {
  return count >= REVIEWS_PUBLIC_MIN;
}

/**
 * Splits the featured pull-quotes between the home band and the pricing rail
 * so no review appears twice on the same page. With too few to go round the
 * home band wins and the rail renders nothing — repeating the band's three
 * quotes four sections further down is worse than showing none.
 *
 * slice() already returns [] past the end, so neither half needs a guard:
 * whether the rail renders is `pricing.length > 0` at the call site.
 */
export function splitFeatured<T>(featured: readonly T[]): {
  home: T[];
  pricing: T[];
} {
  return {
    home: featured.slice(0, HOME_FEATURED),
    pricing: featured.slice(HOME_FEATURED, HOME_FEATURED + PRICING_FEATURED),
  };
}

/**
 * The sr-only sentence for any star display. The visible numerals and the bar
 * are aria-hidden, so this is the ONLY rating text a screen reader gets — it
 * must never degrade to a bare "4.6".
 */
export function starLabel(value: number | string, total?: number): string {
  const shown = typeof value === "string" ? value : String(value);
  const base = `Rated ${shown} out of ${REVIEW_RATING_MAX}`;
  if (total === undefined) return base;
  return `${base}, from ${total} review${total === 1 ? "" : "s"}`;
}

/**
 * Whether to ask for a review on the results page.
 *
 * Suppressed when the trial upsell is showing: two asks after one score is
 * noise, and the upsell converts money. The accuracy floor reuses
 * ACCURACY_PASS rather than inventing a second "good score" number — the
 * caller passes it in so this stays import-free.
 */
export function shouldPromptForReview(input: {
  scorePct: number;
  answered: number;
  passMark: number;
  hasReviewed: boolean;
  upsellShown: boolean;
}): boolean {
  if (input.hasReviewed || input.upsellShown) return false;
  // A one-question tutor drill at 100% is not evidence of anything.
  if (input.answered < 10) return false;
  return input.scorePct >= input.passMark;
}

/**
 * Questions answered before the dashboard banner is offered.
 *
 * Five, so it reaches people early — including trial users, who get ten free
 * questions and would otherwise never see it. The floor exists only so that
 * a brand-new account is not asked before it has seen anything.
 */
export const REVIEW_BANNER_MIN_ATTEMPTS = 5;

/** Whether the dashboard banner is offered at all. The client only decides
 * whether it was dismissed. */
export function shouldOfferReviewBanner(input: {
  attempted: number;
  hasReviewed: boolean;
}): boolean {
  return !input.hasReviewed && input.attempted >= REVIEW_BANNER_MIN_ATTEMPTS;
}

/**
 * localStorage key for "this person dismissed the review banner".
 *
 * Keyed on the user id, not a bare constant: localStorage is per-device, and
 * two accounts sharing one laptop would otherwise inherit each other's
 * dismissal.
 */
export function reviewBannerKey(userId: string): string {
  return `cmeprep.review-banner.dismissed.${userId}`;
}
