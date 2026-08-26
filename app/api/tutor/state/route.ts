import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { loadTutorState, tutorApiUrl } from "@/lib/tutor";

export const runtime = "nodejs";
/** Verdict and history are per-request state — never serve a cached copy. */
export const dynamic = "force-dynamic";

/**
 * GET /api/tutor/state — what the floating widget needs to open (SPEC §18).
 *
 * Fetched lazily on first open rather than rendered into the app layout, so
 * the three service-role reads behind it are paid only by students who use
 * the widget, not on every authenticated page. The /tutor page computes the
 * same object server-side through the same helper.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // Same gate as the chat route: a banned account with an open session gets
  // no further reach into the tutor.
  if (user.profile.banned_at) {
    return NextResponse.json({ error: "Account suspended" }, { status: 403 });
  }
  if (!tutorApiUrl()) {
    return NextResponse.json(
      { error: "The tutor isn't available right now." },
      { status: 503 }
    );
  }

  try {
    const state = await loadTutorState(user);
    return NextResponse.json(state, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("tutor state failed", error);
    return NextResponse.json(
      { error: "Could not reach the tutor" },
      { status: 500 }
    );
  }
}
