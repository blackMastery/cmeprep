import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { reportGradeSchema } from "@/lib/validation";
import { getTestForUser } from "@/lib/tests";

/**
 * POST /api/tests/[id]/report-grade — "this AI grade looks wrong".
 *
 * Pure triage signal for admins (fix the model answer, spot a bad judge run).
 * No regrade mechanics: the verdict stands. One report per station per user —
 * a duplicate submit is answered as success rather than an error, because the
 * student's goal (it's flagged) is already met.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/tests/[id]/report-grade">
) {
  const { id } = await ctx.params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = reportGradeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { questionId, note } = parsed.data;

  const test = await getTestForUser(id, user.id);
  if (!test) {
    return NextResponse.json({ error: "Test not found" }, { status: 404 });
  }
  if (test.mode !== "osce") {
    return NextResponse.json({ error: "Not an OSCE session" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Only a station that actually HAS a grade can be reported.
  const [{ data: attempt }, { data: latestEvent }] = await Promise.all([
    admin
      .from("attempts")
      .select("id")
      .eq("test_id", id)
      .eq("question_id", questionId)
      .maybeSingle(),
    admin
      .from("osce_grading_events")
      .select("id")
      .eq("test_id", id)
      .eq("question_id", questionId)
      .not("verdict", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!attempt) {
    return NextResponse.json({ error: "Nothing to report" }, { status: 404 });
  }

  const { error } = await admin.from("osce_grade_reports").insert({
    user_id: user.id,
    test_id: id,
    question_id: questionId,
    grading_event_id: latestEvent?.id ?? null,
    note: note && note.length > 0 ? note : null,
  });
  // 23505 = unique violation: already reported, which is what they wanted.
  if (error && error.code !== "23505") {
    return NextResponse.json({ error: "Could not report" }, { status: 500 });
  }

  return NextResponse.json({ reported: true }, { status: 201 });
}
