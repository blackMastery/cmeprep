import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { finalizeTest, getTestForUser } from "@/lib/tests";

/**
 * POST /api/tests/[id]/submit — score and close a test.
 *
 * Idempotent: submitting an already-submitted test returns its existing score
 * rather than rescoring. Expiry is enforced server-side inside finalizeTest,
 * so a tampered client clock cannot extend a test.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/tests/[id]/submit">
) {
  const { id } = await ctx.params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const existing = await getTestForUser(id, user.id);
  if (!existing) {
    return NextResponse.json({ error: "Test not found" }, { status: 404 });
  }

  if (existing.status !== "in_progress") {
    return NextResponse.json({
      id: existing.id,
      status: existing.status,
      score: existing.score,
      alreadySubmitted: true,
    });
  }

  let test: Awaited<ReturnType<typeof finalizeTest>>;
  try {
    test = await finalizeTest(id, user.id, "submitted");
  } catch (error) {
    console.error("submit failed", error);
    return NextResponse.json({ error: "Could not submit" }, { status: 500 });
  }

  if (!test) {
    return NextResponse.json({ error: "Could not submit" }, { status: 500 });
  }

  return NextResponse.json({
    id: test.id,
    status: test.status,
    score: test.score,
    alreadySubmitted: false,
  });
}
