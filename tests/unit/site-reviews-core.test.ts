import { describe, expect, it } from "vitest";
import {
  normalizeReviewBody,
  ratingCountsToSummary,
  reviewBannerKey,
  reviewBodyIssue,
  reviewBodyLength,
  reviewDisplayName,
  reviewEligibility,
  reviewsArePublic,
  REVIEW_BODY_MAX,
  REVIEW_BODY_MIN,
  REVIEW_DISPLAY_NAME_MAX,
  REVIEW_FALLBACK_NAME,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUSES,
  REVIEWS_PUBLIC_MIN,
  shouldOfferReviewBanner,
  shouldPromptForReview,
  splitFeatured,
  starLabel,
  verifiedPurchase,
} from "@/lib/site-reviews-core";

describe("ratingCountsToSummary", () => {
  it("reports nothing at all when there are no reviews", () => {
    const summary = ratingCountsToSummary([]);
    expect(summary.count).toBe(0);
    // Null, not "0.0" — nothing may render an average over zero ratings.
    expect(summary.averageLabel).toBeNull();
  });

  it("keeps the trailing decimal on a whole average", () => {
    const summary = ratingCountsToSummary([{ rating: 5, reviews: 1 }]);
    expect(summary.averageLabel).toBe("5.0");
  });

  it("rounds half UP, not to even", () => {
    // 5+5+5+4 = 19 / 4 = 4.75. Banker's rounding would give "4.8" here too,
    // so pin the case that actually separates them as well.
    const summary = ratingCountsToSummary([
      { rating: 5, reviews: 3 },
      { rating: 4, reviews: 1 },
    ]);
    expect(summary.averageLabel).toBe("4.8");
  });

  it("rounds 4.25 up to 4.3 (integer-first, not float-first)", () => {
    // 5+5+4+3 = 17 / 4 = 4.25 -> 42.5 -> 43. Computing from the float would
    // risk 42.499999... and produce "4.2".
    const summary = ratingCountsToSummary([
      { rating: 5, reviews: 2 },
      { rating: 4, reviews: 1 },
      { rating: 3, reviews: 1 },
    ]);
    expect(summary.averageLabel).toBe("4.3");
  });

  it("averages a repeating decimal to one place", () => {
    // 5+5+4 = 14 / 3 = 4.666...
    const summary = ratingCountsToSummary([
      { rating: 5, reviews: 2 },
      { rating: 4, reviews: 1 },
    ]);
    expect(summary.averageLabel).toBe("4.7");
  });

  it("counts every bucket the histogram returned", () => {
    const summary = ratingCountsToSummary([
      { rating: 5, reviews: 2 },
      { rating: 1, reviews: 1 },
    ]);
    expect(summary.count).toBe(3);
    // (5+5+1)/3 = 3.666...
    expect(summary.averageLabel).toBe("3.7");
  });

  it("ignores ratings outside 1-5 rather than inventing a bucket", () => {
    const summary = ratingCountsToSummary([
      { rating: 5, reviews: 2 },
      { rating: 0, reviews: 9 },
      { rating: 7, reviews: 9 },
    ]);
    expect(summary.count).toBe(2);
    expect(summary.averageLabel).toBe("5.0");
  });
});

describe("the cold-start gate", () => {
  it("publishes as soon as one review is approved", () => {
    expect(REVIEWS_PUBLIC_MIN).toBe(1);
    expect(reviewsArePublic(1)).toBe(true);
    expect(reviewsArePublic(47)).toBe(true);
  });

  it("shows nothing at all while none is approved", () => {
    // The only hidden case now. Pinned because everything public keys off it:
    // the band, the /reviews list and the aggregateRating markup.
    expect(reviewsArePublic(0)).toBe(false);
  });

});

describe("splitFeatured", () => {
  it("gives the home band and the pricing rail different quotes", () => {
    const six = ["a", "b", "c", "d", "e", "f"];
    expect(splitFeatured(six)).toEqual({
      home: ["a", "b", "c"],
      pricing: ["d", "e", "f"],
    });
  });

  it("gives the rail the remainder when there are only a few", () => {
    expect(splitFeatured(["a", "b", "c", "d"])).toEqual({
      home: ["a", "b", "c"],
      pricing: ["d"],
    });
  });

  it("renders no rail rather than repeating the band", () => {
    expect(splitFeatured(["a", "b", "c"])).toEqual({
      home: ["a", "b", "c"],
      pricing: [],
    });
    expect(splitFeatured(["a"])).toEqual({ home: ["a"], pricing: [] });
    expect(splitFeatured([])).toEqual({ home: [], pricing: [] });
  });

  it("never hands the rail more than it can show", () => {
    const nine = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    expect(splitFeatured(nine).pricing).toEqual(["d", "e", "f"]);
  });
});

describe("reviewBodyIssue", () => {
  it("accepts a body exactly at each bound", () => {
    expect(reviewBodyIssue("x".repeat(REVIEW_BODY_MIN))).toBeNull();
    expect(reviewBodyIssue("x".repeat(REVIEW_BODY_MAX))).toBeNull();
  });

  it("rejects one character either side", () => {
    expect(reviewBodyIssue("x".repeat(REVIEW_BODY_MIN - 1))).not.toBeNull();
    expect(reviewBodyIssue("x".repeat(REVIEW_BODY_MAX + 1))).not.toBeNull();
  });

  it("trims before measuring, so padding cannot buy length", () => {
    const padded = ` ${"x".repeat(REVIEW_BODY_MIN - 1)} `;
    expect(padded.length).toBeGreaterThan(REVIEW_BODY_MIN);
    expect(reviewBodyIssue(padded)).not.toBeNull();
    expect(reviewBodyIssue(`  ${"x".repeat(REVIEW_BODY_MIN)}  `)).toBeNull();
  });

  it("has its own message for an empty body", () => {
    expect(reviewBodyIssue("   ")).toBe(
      "Write a few words about your experience.",
    );
  });

  // Both of these used to pass validation and then violate the DB CHECK,
  // which raises 23514 — not the 23505 the insert handles — so the route
  // could only report a generic 500 and the review was lost.
  it("measures the NORMALIZED body, not the raw one", () => {
    // Blank-line runs collapse on the way into the column, so a body padded
    // with newlines is shorter than it looks.
    const padded = `${"a".repeat(20)}${"\n".repeat(25)}${"b".repeat(17)}`;
    expect(padded.trim().length).toBeGreaterThan(REVIEW_BODY_MIN);
    expect(reviewBodyLength(padded)).toBeLessThan(REVIEW_BODY_MIN);
    expect(reviewBodyIssue(padded)).not.toBeNull();
  });

  it("measures code points, not UTF-16 units", () => {
    // 20 astral characters: String.length says 40, char_length() says 20.
    const emoji = "🙂".repeat(20);
    expect(emoji.length).toBe(40);
    expect(reviewBodyLength(emoji)).toBe(20);
    expect(reviewBodyIssue(emoji)).not.toBeNull();
  });

  it("accepts a body that is long enough in code points", () => {
    const emoji = "🙂".repeat(REVIEW_BODY_MIN);
    expect(reviewBodyLength(emoji)).toBe(REVIEW_BODY_MIN);
    expect(reviewBodyIssue(emoji)).toBeNull();
  });

  it("rejects an over-long body counted in code points", () => {
    expect(reviewBodyIssue("🙂".repeat(REVIEW_BODY_MAX + 1))).not.toBeNull();
  });
});

describe("normalizeReviewBody", () => {
  it("keeps a paragraph break but collapses a wall of blank lines", () => {
    expect(normalizeReviewBody("a\n\nb")).toBe("a\n\nb");
    expect(normalizeReviewBody("a\n\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("normalises CRLF and trims the ends", () => {
    expect(normalizeReviewBody("\r\n a\r\n\r\n\r\n\r\nb \r\n")).toBe("a\n\nb");
  });
});

describe("reviewDisplayName", () => {
  it("falls back when there is no name to publish", () => {
    expect(reviewDisplayName(null)).toBe(REVIEW_FALLBACK_NAME);
    expect(reviewDisplayName("")).toBe(REVIEW_FALLBACK_NAME);
    expect(reviewDisplayName("   ")).toBe(REVIEW_FALLBACK_NAME);
  });

  it("collapses internal whitespace", () => {
    expect(reviewDisplayName("  Dr.  Anita   Persaud ")).toBe(
      "Dr. Anita Persaud",
    );
  });

  it("caps without leaving a dangling space", () => {
    const long = `${"a".repeat(REVIEW_DISPLAY_NAME_MAX - 1)} surname`;
    const capped = reviewDisplayName(long);
    expect(capped.length).toBeLessThanOrEqual(REVIEW_DISPLAY_NAME_MAX);
    expect(capped).toBe(capped.trimEnd());
  });

  it("caps by code point and never splits a surrogate pair", () => {
    // A UTF-16 slice would cut the 40th emoji in half and send a lone
    // surrogate to Postgres.
    const capped = reviewDisplayName("🙂".repeat(100));
    expect([...capped]).toHaveLength(REVIEW_DISPLAY_NAME_MAX);
    expect(capped).toBe("🙂".repeat(REVIEW_DISPLAY_NAME_MAX));
  });
});

describe("reviewEligibility", () => {
  it("lets a trial user review — role is deliberately not an input", () => {
    // Eligibility was opened up from "verified purchaser"; this test exists so
    // that reintroducing a role check breaks something visible.
    expect(
      reviewEligibility({ bannedAt: null, alreadyReviewed: false }),
    ).toEqual({ ok: true });
  });

  it("refuses a second review", () => {
    expect(
      reviewEligibility({ bannedAt: null, alreadyReviewed: true }),
    ).toEqual({ ok: false, reason: "already_reviewed" });
  });

  it("puts banned ahead of already-reviewed", () => {
    expect(
      reviewEligibility({
        bannedAt: "2026-01-01T00:00:00Z",
        alreadyReviewed: true,
      }),
    ).toEqual({ ok: false, reason: "banned" });
  });
});

describe("verifiedPurchase", () => {
  it("counts a subscription or a payment, and nothing else", () => {
    expect(verifiedPurchase({ subscriptions: 0, payments: 0 })).toBe(false);
    expect(verifiedPurchase({ subscriptions: 1, payments: 0 })).toBe(true);
    expect(verifiedPurchase({ subscriptions: 0, payments: 1 })).toBe(true);
  });
});

describe("starLabel", () => {
  it("never degrades to a bare number", () => {
    expect(starLabel("4.6", 47)).toBe("Rated 4.6 out of 5, from 47 reviews");
    expect(starLabel("5.0", 1)).toBe("Rated 5.0 out of 5, from 1 review");
    expect(starLabel(5)).toBe("Rated 5 out of 5");
  });
});

describe("prompt rules", () => {
  const base = {
    scorePct: 90,
    answered: 20,
    passMark: 75,
    hasReviewed: false,
    upsellShown: false,
  };

  it("asks after a strong score on a real test", () => {
    expect(shouldPromptForReview(base)).toBe(true);
  });

  it("stays quiet below the pass mark", () => {
    expect(shouldPromptForReview({ ...base, scorePct: 74 })).toBe(false);
    expect(shouldPromptForReview({ ...base, scorePct: 75 })).toBe(true);
  });

  it("ignores a perfect score on a two-question drill", () => {
    expect(shouldPromptForReview({ ...base, scorePct: 100, answered: 2 })).toBe(
      false,
    );
  });

  it("yields to the trial upsell", () => {
    expect(shouldPromptForReview({ ...base, upsellShown: true })).toBe(false);
  });

  it("never asks twice", () => {
    expect(shouldPromptForReview({ ...base, hasReviewed: true })).toBe(false);
  });

  it("offers the banner only to someone who has used the product", () => {
    expect(shouldOfferReviewBanner({ attempted: 19, hasReviewed: false })).toBe(
      false,
    );
    expect(shouldOfferReviewBanner({ attempted: 20, hasReviewed: false })).toBe(
      true,
    );
    expect(shouldOfferReviewBanner({ attempted: 500, hasReviewed: true })).toBe(
      false,
    );
  });
});

describe("reviewBannerKey", () => {
  it("scopes the dismissal to one account on a shared device", () => {
    expect(reviewBannerKey("abc")).not.toBe(reviewBannerKey("def"));
    expect(reviewBannerKey("abc")).toContain("abc");
  });
});

describe("status labels", () => {
  it("labels every status exactly once", () => {
    expect(Object.keys(REVIEW_STATUS_LABELS).sort()).toEqual(
      [...REVIEW_STATUSES].sort(),
    );
  });
});
