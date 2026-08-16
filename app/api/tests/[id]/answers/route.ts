import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { saveAnswersSchema } from "@/lib/validation";
import { getTestForUser, isExpired, SUBMIT_GRACE_SEC } from "@/lib/tests";

/**
 * PATCH /api/tests/[id]/answers — autosave staged selections and flags.
 * Accepts a batch so the unload beacon can flush everything at once.
 */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/tests/[id]/answers">
) {
  const { id } = await ctx.params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = saveAnswersSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const test = await getTestForUser(id, user.id);
  if (!test) {
    return NextResponse.json({ error: "Test not found" }, { status: 404 });
  }
  if (test.status !== "in_progress") {
    return NextResponse.json(
      { error: "Test already submitted" },
      { status: 409 }
    );
  }
  if (isExpired(test, SUBMIT_GRACE_SEC)) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  const admin = createAdminClient();

  // Only accept answers for questions that actually belong to this test.
  const [{ data: links }, revealedRes] = await Promise.all([
    admin.from("test_questions").select("question_id").eq("test_id", id),
    // Tutor mode only — exam rows can never be revealed, so exam autosaves
    // (the hottest write path) skip the extra query. Best-effort filter: the
    // rare reveal landing between this read and the upsert can still clobber
    // the staged selection, but never revealed_at (not in `rows`), and both
    // resume (getTakeState) and finalize treat the attempts row as the
    // graded truth for revealed questions, so the stale write is inert.
    test.mode === "tutor"
      ? admin
          .from("test_answers")
          .select("question_id")
          .eq("test_id", id)
          .not("revealed_at", "is", null)
      : Promise.resolve({ data: null }),
  ]);
  const allowed = new Set((links ?? []).map((l) => l.question_id));
  const locked = new Set((revealedRes.data ?? []).map((r) => r.question_id));

  const rows = parsed.data.answers
    .filter((a) => allowed.has(a.questionId) && !locked.has(a.questionId))
    .map((a) => ({
      test_id: id,
      question_id: a.questionId,
      selected_option_ids: a.selectedOptionIds,
      flagged: a.flagged ?? false,
      time_spent_sec: a.timeSpentSec ?? 0,
      updated_at: new Date().toISOString(),
    }));

  if (rows.length === 0) {
    return NextResponse.json({ saved: 0 });
  }

  const { error } = await admin
    .from("test_answers")
    .upsert(rows, { onConflict: "test_id,question_id" });

  if (error) {
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }

  return NextResponse.json({ saved: rows.length, at: new Date().toISOString() });
}
