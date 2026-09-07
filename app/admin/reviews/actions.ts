"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { REVIEW_STATUSES } from "@/lib/site-reviews-core";
import type { SiteReviewStatus } from "@/lib/supabase/types";
import { uuid } from "@/lib/validation";
import type { AdminState } from "@/app/admin/subjects/actions";

/**
 * Moderation of product reviews.
 *
 * requireAdmin() is the FIRST statement of every action, outside any
 * try/catch — see app/admin/questions/actions.ts for why.
 *
 * There is deliberately no action that edits a review's text and none that
 * deletes a row: an admin never changes a reviewer's words, and the
 * one-per-user unique index IS the "once ever" rule, so a delete would
 * silently grant a re-review.
 */

/** Everything a verdict touches. The public surfaces are per-request dynamic
 * today, so the last two are no-ops — they are here so that adding a cache
 * later cannot strand a rejected quote on the marketing page. */
function revalidateReviews() {
  revalidatePath("/admin/reviews");
  // The pending badge is rendered by the admin layout.
  revalidatePath("/admin", "layout");
  revalidatePath("/");
  revalidatePath("/reviews");
}

function parseStatus(
  value: FormDataEntryValue | null,
): SiteReviewStatus | null {
  return REVIEW_STATUSES.find((s) => s === value) ?? null;
}

export async function moderateSiteReview(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown review." };

  const decision = formData.get("decision");
  if (decision !== "approve" && decision !== "reject") {
    return { error: "Unknown decision." };
  }
  const approve = decision === "approve";

  // The status the BUTTON WAS RENDERED AGAINST, carried in a hidden field.
  const from = parseStatus(formData.get("from"));
  if (!from) return { error: "Unknown review." };

  const now = new Date().toISOString();

  const { data, error } = await createAdminClient()
    .from("site_reviews")
    .update({
      status: approve ? "approved" : "rejected",
      moderated_at: now,
      moderated_by: user.id,
      updated_at: now,
      // Rejecting ALWAYS clears the pull-quote flag. The CHECK
      // (not featured or status = 'approved') would refuse the update
      // otherwise; clearing it here keeps that constraint a backstop rather
      // than an error a moderator has to decode.
      ...(approve ? {} : { featured: false }),
    })
    .eq("id", id.data)
    // Compare-and-swap, not read-then-write: two admins on the same queue, or
    // one stale tab, can never overwrite a verdict they never saw. Matching on
    // the rendered status rather than a literal 'pending' is also what keeps
    // the rejected -> approved reversal working.
    .eq("status", from)
    .select("id")
    .maybeSingle();

  if (error) return { error: "Could not update the review." };
  // No row back means someone got there first. No audit row: their verdict
  // already tells the story.
  if (!data) return { success: "Someone already moderated this one." };

  await audit(
    user.id,
    approve ? "site_review.approve" : "site_review.reject",
    id.data,
  );
  revalidateReviews();
  return { success: approve ? "Published." : "Rejected." };
}

export async function setSiteReviewFeatured(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown review." };
  const featured = formData.get("featured") === "true";

  const now = new Date().toISOString();

  const { data, error } = await createAdminClient()
    .from("site_reviews")
    .update({ featured, updated_at: now })
    .eq("id", id.data)
    // The status guard turns "it was rejected a second ago" into a reported
    // no-op instead of a CHECK violation; the featured guard makes a
    // double-click idempotent.
    .eq("status", "approved")
    .eq("featured", !featured)
    .select("id")
    .maybeSingle();

  if (error) return { error: "Could not update the review." };
  if (!data) return { success: "Nothing to change — someone got there first." };

  await audit(
    user.id,
    featured ? "site_review.feature" : "site_review.unfeature",
    id.data,
  );
  revalidateReviews();
  return {
    success: featured
      ? "Added to the marketing page."
      : "Removed from the marketing page.",
  };
}
