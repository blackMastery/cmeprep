import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { examAccessFrom } from "@/lib/entitlements";
import { tutorAskSchema } from "@/lib/validation";
import { getTutorUsage, tutorApiUrl, tutorHeaders } from "@/lib/tutor";
import {
  stripLinks,
  tutorAccessFor,
  validateQuestion,
} from "@/lib/tutor-core";

export const runtime = "nodejs";
/** The response is a live SSE stream; anything cached or statically rendered
 * would defeat the point. */
export const dynamic = "force-dynamic";
/**
 * A tutor answer is a retrieval plus a full generation, and the Render
 * instance may be cold — first token can be tens of seconds. The platform
 * default would cut the stream mid-answer. 60s is the Hobby ceiling and is
 * within Pro; raise it to 300 once the project is on Pro.
 */
export const maxDuration = 60;

/**
 * POST /api/tutor/chat — the SSE proxy to the FastAPI tutor service.
 *
 * The browser never talks to the tutor service directly. This handler is the
 * single chokepoint where entitlement and the message caps are enforced, and
 * it is the only place holding TUTOR_SHARED_SECRET. It also rewrites the
 * upstream `done` frame: the tutor cites source files by their Google Drive
 * URL, which no student can open and which is a direct handle on licensed
 * material, so the link is dropped before the stream reaches the browser.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // Every call spends real money (embedding + generation) — mirror the OSCE
  // grade route so a banned account with an open session can't keep spending.
  if (user.profile.banned_at) {
    return NextResponse.json({ error: "Account suspended" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = tutorAskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const question = parsed.data.question.trim();
  const guard = validateQuestion(question);
  if (guard) {
    return NextResponse.json({ error: guard }, { status: 400 });
  }

  const base = tutorApiUrl();
  if (!base) {
    // Fails closed, like the cron routes: a missing URL is a deployment
    // mistake, not something to paper over with a localhost fallback.
    return NextResponse.json(
      { error: "The tutor isn't available right now." },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const admin = createAdminClient();

  let access;
  let usage;
  try {
    [access, usage] = await Promise.all([
      examAccessFrom(supabase, user.id, user.profile.role),
      getTutorUsage(admin, user.id),
    ]);
  } catch {
    return NextResponse.json(
      { error: "Could not reach the tutor" },
      { status: 500 }
    );
  }

  const verdict = tutorAccessFor(user.profile.role, access, usage);
  if (!verdict.allowed) {
    // 403 is "you don't have this feature" (upsell); 429 is "you do, but
    // you're out for now" — the client branches on the code to decide
    // whether to show a paywall or a wait-until-midnight message.
    const status = verdict.reason === "no_access" ? 403 : 429;
    return NextResponse.json(
      { error: verdict.message, code: verdict.reason },
      { status }
    );
  }

  // The tutor service verifies this token against the same Supabase JWKS and
  // derives the student's id from `sub` — it never trusts a user id we send.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${base}/chat`, {
      method: "POST",
      headers: tutorHeaders(session.access_token),
      body: JSON.stringify({ question }),
      // A student who closes the tab or hits stop should cancel the
      // generation rather than leaving it to run and bill.
      signal: request.signal,
    });
  } catch (error) {
    console.error("tutor service unreachable", error);
    return NextResponse.json(
      { error: "Couldn't reach the tutor just now — try again." },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    console.error("tutor service returned", upstream.status);
    // 401 is passed through rather than flattened into 502: the access token
    // expired mid-session, and the client can recover by refreshing. A 403
    // means our shared secret is wrong — a deployment fault the student can
    // do nothing about, so it stays a generic upstream failure, distinguished
    // only in the log above.
    if (upstream.status === 401) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Couldn't reach the tutor just now — try again." },
      { status: 502 }
    );
  }

  return new Response(upstream.body.pipeThrough(stripLinks()), {
    headers: {
      "Content-Type": "text/event-stream",
      // no-transform matters as much as no-cache: a proxy that "helpfully"
      // compresses or buffers the body turns a stream into one late blob.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
