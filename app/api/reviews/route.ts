import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { submitSiteReview } from "@/lib/site-reviews";
import { siteReviewSchema } from "@/lib/validation";

/**
 * The one endpoint all three review entry points post to: the profile card,
 * the post-results prompt and the dashboard banner. Every rule lives in
 * lib/site-reviews.ts; this file only authenticates and shapes JSON.
 *
 * A route rather than a Server Action because the submit has outcomes the UI
 * must tell apart — 409 "you've already reviewed" reads nothing like a 400 —
 * and because nothing on the page changes on success except the form itself,
 * so there is no revalidatePath worth a round trip.
 *
 * There is no GET: whether you have already reviewed comes from the page
 * calling hasReviewed(), not from the browser asking.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.profile.banned_at) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = siteReviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // userId comes from the session and is spread BEFORE ...parsed.data, and
  // siteReviewSchema has no userId field — a body field cannot win.
  const result = await submitSiteReview({ userId: user.id, ...parsed.data });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json({ submitted: true }, { status: 201 });
}
