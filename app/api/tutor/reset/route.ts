import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resetConversation, tutorApiUrl } from "@/lib/tutor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tutor/reset — start a new conversation.
 *
 * Not a delete: chat_messages is the audit trail and keeps everything. This
 * moves the boundary this app renders history from AND clears the tutor's
 * checkpointer thread, so the model forgets what the screen no longer shows.
 */
export async function POST() {
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

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    await resetConversation(createAdminClient(), user.id, session.access_token);
  } catch (error) {
    console.error("tutor reset failed", error);
    return NextResponse.json(
      { error: "Couldn't start a new conversation — try again." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
