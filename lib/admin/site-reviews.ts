import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { SiteReviewStatus, UserRole } from "@/lib/supabase/types";

export const SITE_REVIEWS_PAGE_SIZE = 25;

/**
 * What the moderation queue renders — NOT the whole row.
 *
 * The table component is a Client Component, so whatever this returns is
 * serialised into the RSC payload of /admin/reviews. Selecting `*` shipped
 * user_id, consent_at and moderated_by to the browser and would have shipped
 * every column added later, silently. Same rule as the public reads in
 * lib/site-reviews.ts: project by name.
 */
export type AdminSiteReview = {
  id: string;
  rating: number;
  body: string;
  display_name: string;
  verified_purchase: boolean;
  role_at_submit: UserRole;
  exam_name: string | null;
  status: SiteReviewStatus;
  featured: boolean;
  created_at: string;
};

const ADMIN_COLUMNS =
  "id, rating, body, display_name, verified_purchase, role_at_submit, exam_name, status, featured, created_at";

export type SiteReviewFilter = "pending" | "approved" | "rejected" | "all";

export const SITE_REVIEW_FILTERS: readonly {
  value: SiteReviewFilter;
  label: string;
}[] = [
  { value: "pending", label: "Waiting" },
  { value: "approved", label: "Published" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

export function isSiteReviewFilter(value: unknown): value is SiteReviewFilter {
  return SITE_REVIEW_FILTERS.some((f) => f.value === value);
}

export async function listSiteReviews(options: {
  filter?: SiteReviewFilter;
  page?: number;
}): Promise<{
  rows: AdminSiteReview[];
  total: number;
  page: number;
  pageCount: number;
  /** Totals across every page — the badge and the cold-start line both need
   * the whole picture, not this page's slice. */
  pending: number;
  approved: number;
}> {
  const admin = createAdminClient();
  const filter = options.filter ?? "pending";
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const from = (page - 1) * SITE_REVIEWS_PAGE_SIZE;

  // A moderation queue is FIFO — the person who has waited longest gets an
  // answer first. That is the deliberate difference from the messages inbox,
  // which is newest-first. Both directions ride site_reviews_status_idx.
  const oldestFirst = filter === "pending";

  let query = admin
    .from("site_reviews")
    .select(ADMIN_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: oldestFirst })
    // The id tiebreak is not decoration: without it .range() can drop or
    // repeat a row when two share a created_at, so a pending review could sit
    // on no page of the queue while the badge kept counting it.
    .order("id", { ascending: oldestFirst })
    .range(from, from + SITE_REVIEWS_PAGE_SIZE - 1);

  if (filter !== "all") query = query.eq("status", filter);

  const [
    { data, count, error },
    { count: pending, error: pendingError },
    { count: approved, error: approvedError },
  ] = await Promise.all([
    query,
    admin
      .from("site_reviews")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    admin
      .from("site_reviews")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved"),
  ]);

  // Surfaced, not swallowed: a failed read and an empty queue are the same
  // screen otherwise, and "the queue is empty" is the reading a moderator
  // will take while pending reviews go unanswered.
  if (error || pendingError || approvedError) {
    throw new Error(
      `Could not load the review queue: ${(error ?? pendingError ?? approvedError)?.message}`,
    );
  }

  const total = count ?? 0;

  return {
    rows: (data ?? []) as AdminSiteReview[],
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / SITE_REVIEWS_PAGE_SIZE)),
    pending: pending ?? 0,
    approved: approved ?? 0,
  };
}

/** Pending count on its own, for the sidebar badge. */
export async function pendingSiteReviewCount(): Promise<number> {
  const { count } = await createAdminClient()
    .from("site_reviews")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  return count ?? 0;
}
