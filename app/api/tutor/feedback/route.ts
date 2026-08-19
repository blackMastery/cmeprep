import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { tutorFeedbackSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * POST /api/tutor/feedback — rate one tutor answer, optionally with detail.
 *
 * The quality signal for a strict-RAG tutor: a thumbs-down usually means
 * retrieval missed or the corpus has a gap, and a thumbs-up says the passages
 * actually answered the question — the only evidence that MIN_SCORE and the
 * chunking are tuned right. No regeneration; the answer stands, as with OSCE
 * grade reports.
 *
 * Idempotent per (user, answer): the UI records the rating on click and sends
 * the note afterwards, so the same row is written twice in the normal flow.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (user.profile.banned_at) {
    return NextResponse.json({ error: "Account suspended" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = tutorFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { messageId, rating, note } = parsed.data;

  const admin = createAdminClient();

  // Ownership check: chat_messages is service-role only, so without this a
  // student could rate another student's conversation and pull its content
  // into the admin queue.
  const { data: message, error } = await admin
    .from("chat_messages")
    .select("id, user_id, role")
    .eq("id", messageId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "Could not save feedback" }, { status: 500 });
  }
  if (!message || message.user_id !== user.id || message.role !== "assistant") {
    return NextResponse.json({ error: "Answer not found" }, { status: 404 });
  }

  // Re-rating replaces the previous verdict, and re-opens it for triage: an
  // answer someone changed their mind about is worth a second look, whatever
  // an admin decided the first time.
  const { error: writeError } = await admin.from("tutor_answer_feedback").upsert(
    {
      user_id: user.id,
      message_id: messageId,
      rating,
      // Undefined leaves any existing note alone — the rating click sends no
      // note, and it must not wipe detail added on a previous pass.
      ...(note === undefined ? {} : { note: note || null }),
      handled_at: null,
      handled_by: null,
    },
    { onConflict: "user_id,message_id" }
  );
  if (writeError) {
    console.error("tutor feedback write failed", writeError);
    return NextResponse.json({ error: "Could not save feedback" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
