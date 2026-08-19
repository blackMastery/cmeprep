import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { tutorReportSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * POST /api/tutor/report — "this answer was wrong".
 *
 * The quality signal for a strict-RAG tutor: a report usually means either the
 * retrieval missed or the corpus has a gap, and both are fixable. Follows
 * osce_grade_reports — no regeneration, the answer stands.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // Same gate as the chat route: a banned account with an open session gets
  // no further reach into the tutor.
  if (user.profile.banned_at) {
    return NextResponse.json({ error: "Account suspended" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = tutorReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { messageId, note } = parsed.data;

  const admin = createAdminClient();

  // Ownership check: chat_messages is service-role only, so without this a
  // student could file reports against another student's conversation and
  // pull its content into the admin queue.
  const { data: message, error } = await admin
    .from("chat_messages")
    .select("id, user_id, role")
    .eq("id", messageId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "Could not report" }, { status: 500 });
  }
  if (!message || message.user_id !== user.id || message.role !== "assistant") {
    return NextResponse.json({ error: "Answer not found" }, { status: 404 });
  }

  // Idempotent: reporting twice is a no-op, not a duplicate-key error.
  const { error: insertError } = await admin
    .from("tutor_answer_reports")
    .upsert(
      { user_id: user.id, message_id: messageId, note: note || null },
      { onConflict: "user_id,message_id", ignoreDuplicates: true }
    );
  if (insertError) {
    console.error("tutor report insert failed", insertError);
    return NextResponse.json({ error: "Could not report" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
