import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAdminReviewSubmitted } from "@/lib/notifications";
import { guyanaDay } from "@/lib/orgs-core";
import { pickPrimaryExam } from "@/lib/plan-core";
import {
  normalizeReviewBody,
  ratingCountsToSummary,
  reviewDisplayName,
  reviewEligibility,
  verifiedPurchase,
  VERIFIED_PAYMENT_STATUSES,
  type ReviewSummary,
} from "@/lib/site-reviews-core";

/**
 * Product reviews — the student write path and every public read.
 *
 * site_reviews is service-role only and has no anon-readable view, so this
 * module is the ONLY door. Two rules hold the whole design up:
 *
 *  1. Every read selects display columns BY NAME, never `*`. Without a
 *     restricted view that is the only thing keeping user_id, consent_at,
 *     role_at_submit and moderated_by out of the serialised RSC payload of a
 *     public marketing page.
 *  2. Every public read filters `status = 'approved'` here, so that rule is
 *     stated once rather than in four call sites that can drift.
 */

/** One review as the public surfaces render it. Nothing else leaves here. */
export type PublicReview = {
  id: string;
  rating: number;
  body: string;
  displayName: string;
  verifiedPurchase: boolean;
  createdAt: string;
};

/** The display columns, in one place, so no caller can widen the projection. */
const PUBLIC_COLUMNS =
  "id, rating, body, display_name, verified_purchase, created_at";

/**
 * A hard ceiling on the public list. PostgREST caps a response at
 * max_rows = 1000 and says nothing when it truncates, so state our own bound
 * rather than inherit a silent one.
 */
const REVIEWS_MAX_RANGE = 200;

type PublicRow = {
  id: string;
  rating: number;
  body: string;
  display_name: string;
  verified_purchase: boolean;
  created_at: string;
};

function toPublicReview(row: PublicRow): PublicReview {
  return {
    id: row.id,
    rating: row.rating,
    body: row.body,
    displayName: row.display_name,
    verifiedPurchase: row.verified_purchase,
    createdAt: row.created_at,
  };
}

export type SubmitReviewResult =
  | { ok: true; status: "created" }
  | { ok: false; status: 400 | 403 | 409 | 500; error: string };

/**
 * Record one review. Pre-moderated, so this never sets `status` or
 * `featured` — the column defaults say publishing is a human decision.
 *
 * Everything from display_name down is a SNAPSHOT read here and frozen: a
 * later rename, a lapsed subscription or a deleted exam must not change the
 * meaning of a quote we already published.
 */
export async function submitSiteReview(input: {
  userId: string;
  rating: number;
  body: string;
  /** Literally `true` — siteReviewSchema's z.literal(true) is the proof, and
   * this is where it becomes consent_at. Typed as the literal so no caller
   * can pass a false. */
  consent: true;
}): Promise<SubmitReviewResult> {
  const admin = createAdminClient();
  const now = new Date();

  // Eligibility FIRST, on its own, before any of the snapshot reads.
  //
  // There is no rate limit on this endpoint (the unique index is the only
  // cap), so the cheap path has to be the one a caller can repeat: a user who
  // already has a review costs two queries here instead of the five-query
  // fan-out it used to take to reach the same 409.
  //
  // The profile is re-read rather than taken from the caller's session: the
  // snapshot must come from the database at insert time.
  const [
    { data: profile, error: profileError },
    { data: existing, error: existingError },
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("full_name, role, banned_at")
      .eq("id", input.userId)
      .maybeSingle(),
    admin
      .from("site_reviews")
      .select("id")
      .eq("user_id", input.userId)
      .maybeSingle(),
  ]);

  // Surfaced, not swallowed. Every column below `body` is frozen forever with
  // no edit action, so a read that silently returned nothing would mint a
  // permanently wrong snapshot — better to fail the submit and let them retry.
  if (profileError || existingError) {
    console.error("site_review_submit_reads_failed", profileError ?? existingError);
    return { ok: false, status: 500, error: "Could not save your review" };
  }

  // Defensive: getCurrentUser heals a session whose profile vanished, so this
  // should be unreachable from the route.
  if (!profile) {
    return { ok: false, status: 403, error: "Not authenticated" };
  }

  const eligibility = reviewEligibility({
    bannedAt: profile.banned_at,
    alreadyReviewed: Boolean(existing),
  });
  if (!eligibility.ok) {
    return eligibility.reason === "banned"
      ? { ok: false, status: 403, error: "Not authenticated" }
      : { ok: false, status: 409, error: "You've already left a review." };
  }

  const [
    { count: subscriptionCount, error: subError },
    { count: paymentCount, error: payError },
    { data: examStats, error: statsError },
    { data: exams, error: examsError },
  ] = await Promise.all([
    admin
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", input.userId),
    admin
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", input.userId)
      // Money that landed and stayed. Counting every row gave a permanent
      // public "Verified purchase" badge to chargebacks and declined orders.
      .in("status", VERIFIED_PAYMENT_STATUSES),
    admin
      .from("user_exam_stats")
      .select("exam_id, attempts")
      .eq("user_id", input.userId),
    // Batched rather than a serial lookup after pickPrimaryExam: the catalog
    // is a handful of rows, and this keeps the submit to one round trip.
    admin.from("exams").select("id, name"),
  ]);

  if (subError || payError || statsError || examsError) {
    console.error(
      "site_review_snapshot_reads_failed",
      subError ?? payError ?? statsError ?? examsError,
    );
    return { ok: false, status: 500, error: "Could not save your review" };
  }

  // Which exam they actually practised. Reuses the dashboard's tiebreaker
  // rather than re-deriving "their exam", with ONE deliberate input
  // difference from lib/stats.ts: no sitting dates. A review is about what
  // they practised, not what they are about to sit, so this reduces to "most
  // attempts, else the first row". Sorted first so that last fallback is
  // deterministic — PostgREST returns user_exam_stats in no defined order.
  const examId = pickPrimaryExam(
    (examStats ?? [])
      .map((row) => ({
        examId: row.exam_id,
        sittingOn: null,
        windowAttempts: row.attempts,
      }))
      .sort((a, b) => a.examId.localeCompare(b.examId)),
    guyanaDay(now),
  );

  const examName = examId
    ? ((exams ?? []).find((e) => e.id === examId)?.name ?? null)
    : null;

  const row = {
    user_id: input.userId,
    rating: input.rating,
    // The SAME string reviewBodyIssue measured — it normalizes before
    // counting, so what passed validation is what the CHECK now sees.
    body: normalizeReviewBody(input.body),
    display_name: reviewDisplayName(profile.full_name),
    verified_purchase: verifiedPurchase({
      subscriptions: subscriptionCount ?? 0,
      payments: paymentCount ?? 0,
    }),
    role_at_submit: profile.role,
    exam_id: examId,
    exam_name: examName,
    consent_at: now.toISOString(),
  };
  const { data: inserted, error } = await admin
    .from("site_reviews")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 = site_reviews_user_uidx: a second tab, or a second attempt past
    // the pre-check. UNLIKE question reports, this is NOT answered as success:
    // there the student's goal (it's flagged) was already met, whereas here
    // the words they just typed were discarded, and saying "thanks" would be
    // a lie. Same message as the pre-check, so a double-click and a genuine
    // second attempt read identically.
    if (error.code === "23505") {
      return { ok: false, status: 409, error: "You've already left a review." };
    }
    return { ok: false, status: 500, error: "Could not save your review" };
  }

  // Moderators hear at once: nothing is public until one of them rules, and
  // a review that waits a day for the digest is a reviewer left wondering.
  // Never blocks or fails the submit (enqueueEmails swallows).
  if (inserted) {
    await notifyAdminReviewSubmitted(admin, {
      id: inserted.id,
      rating: row.rating,
      displayName: row.display_name,
      examName: row.exam_name,
      verifiedPurchase: row.verified_purchase,
      body: row.body,
    });
  }

  return { ok: true, status: "created" };
}

/**
 * Has this person already reviewed, in ANY status? Gates every entry point.
 * Rejected counts: one review per account, ever.
 *
 * FAILS CLOSED — a read error answers "yes, they have". The two failure
 * directions are not symmetric: answering "no" re-offers the form to someone
 * who already reviewed, and they lose up to 1000 characters to the 409 the
 * unique index raises on submit. Hiding a prompt during an outage costs
 * nothing by comparison.
 */
export async function hasReviewed(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("site_reviews")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("site_reviews_has_reviewed_failed", error);
    return true;
  }
  return Boolean(data);
}

/**
 * Every approved review, newest first — the /reviews wall.
 *
 * Ordered by created_at then id: newest-first rather than featured-first,
 * because sorting a public list by an editorial flag makes the aggregate look
 * cherry-picked, and the id tiebreak is required or .range() can drop or
 * repeat a row when two share a timestamp.
 */
export async function listApprovedReviews(options?: {
  limit?: number;
  offset?: number;
}): Promise<PublicReview[]> {
  const admin = createAdminClient();
  const offset = Math.max(0, options?.offset ?? 0);
  const limit = Math.min(
    options?.limit ?? REVIEWS_MAX_RANGE,
    REVIEWS_MAX_RANGE,
  );
  const { data, error } = await admin
    .from("site_reviews")
    .select(PUBLIC_COLUMNS)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) {
    console.error("site_reviews_list_failed", error);
    return [];
  }
  return (data ?? []).map((row) => toPublicReview(row as PublicRow));
}

/** The marketing pull-quotes: featured AND approved. The status filter is
 * belt-and-braces over the CHECK and the reject action, because a rejected
 * quote frozen on the home page is the failure that matters here. */
export async function listFeaturedReviews(
  limit: number,
): Promise<PublicReview[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("site_reviews")
    .select(PUBLIC_COLUMNS)
    .eq("status", "approved")
    .eq("featured", true)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("site_reviews_featured_failed", error);
    return [];
  }
  return (data ?? []).map((row) => toPublicReview(row as PublicRow));
}

/**
 * Count + average + distribution over approved reviews.
 *
 * An RPC failure returns a zero summary rather than throwing: a marketing
 * page must never 500 over a testimonial band, and a zero summary fails the
 * cold-start gate, so the band simply does not render.
 */
export async function reviewSummary(): Promise<ReviewSummary> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("site_review_rating_counts");
  if (error) {
    console.error("site_review_rating_counts_failed", error);
    return ratingCountsToSummary([]);
  }
  return ratingCountsToSummary(data ?? []);
}

/**
 * One snapshot for the home band and the pricing rail: the pull-quotes, the
 * average and the total all come from the same render. If the cards and the
 * "Read all N reviews" count were fetched separately they could disagree.
 *
 * The try/catch is what actually delivers "a marketing page must never 500
 * over a testimonial band". The per-query error guards below only cover
 * PostgREST failures; createAdminClient() THROWS on a missing or rotated
 * SUPABASE_ADMIN_SECRET_KEY, before any of them are reached — and this is the
 * only service-role read on the public home page.
 */
export async function getHomeReviews(limit: number): Promise<{
  featured: PublicReview[];
  summary: ReviewSummary;
}> {
  try {
    const [featured, summary] = await Promise.all([
      listFeaturedReviews(limit),
      reviewSummary(),
    ]);
    return { featured, summary };
  } catch (error) {
    console.error("site_reviews_home_failed", error);
    // A zero summary fails the cold-start gate, so the band simply does not
    // render and the rest of the page is untouched.
    return { featured: [], summary: ratingCountsToSummary([]) };
  }
}

/** The /reviews page: one page of rows plus the aggregate the JSON-LD and the
 * visible summary BOTH read, so markup and content cannot diverge.
 *
 * `page` must already be a positive integer — pass it through parsePage().
 * A fractional page becomes a fractional PostgREST offset, which is rejected
 * and swallowed into an empty list under a live-looking summary. */
export async function getApprovedReviewsPage(
  page: number,
  pageSize: number,
): Promise<{
  rows: PublicReview[];
  summary: ReviewSummary;
  page: number;
  pageCount: number;
}> {
  const current = Math.max(1, Math.floor(page));
  try {
    const [rows, summary] = await Promise.all([
      listApprovedReviews({ limit: pageSize, offset: (current - 1) * pageSize }),
      reviewSummary(),
    ]);
    return {
      rows,
      summary,
      page: current,
      pageCount: Math.max(1, Math.ceil(summary.count / pageSize)),
    };
  } catch (error) {
    // Same reasoning as getHomeReviews: createAdminClient() throws before the
    // per-query guards, and /reviews is a public page.
    console.error("site_reviews_page_failed", error);
    return {
      rows: [],
      summary: ratingCountsToSummary([]),
      page: current,
      pageCount: 1,
    };
  }
}
