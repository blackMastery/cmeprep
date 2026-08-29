import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { revealAnswerSchema } from "@/lib/validation";
import { getTestForUser } from "@/lib/tests";
import { loadTranslationsFor, translatedRevealFields } from "@/lib/translations";
import { revealFieldsAllowed } from "@/lib/translation-core";
import { correctOptionsInTest, isSelectionCorrect } from "@/lib/scoring";

type RevealPayload = {
  questionId: string;
  isCorrect: boolean;
  selectedOptionIds: string[];
  correctOptionIds: string[];
  explanation: string;
  /** Cached translation of the explanation, when the paper has a language
   * and a current row exists — gated by the same reveal as the English one
   * (translatedRevealFields; getTakeState and the translate route apply the
   * identical rule when re-serving a revealed question). */
  translatedExplanation?: string;
  /** True when a concurrent reveal won — the STORED selection was graded. */
  alreadyRevealed: boolean;
};

/**
 * POST /api/tests/[id]/reveal — tutor mode's "commit this answer".
 *
 * Grades one question mid-test, locks the answer (revealed_at, set once and
 * never cleared), writes the attempts row, and returns correctness plus the
 * explanation. Idempotent: a double-click or second tab gets the stored
 * outcome back — a differing selection on the losing request is discarded,
 * which is exactly what makes a revealed answer immutable.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/tests/[id]/reveal">
) {
  const { id } = await ctx.params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = revealAnswerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { questionId, selectedOptionIds, timeSpentSec } = parsed.data;

  const test = await getTestForUser(id, user.id);
  if (!test) {
    return NextResponse.json({ error: "Test not found" }, { status: 404 });
  }
  // SECURITY BOUNDARY: this endpoint hands out correctness for an in-progress
  // test. That is only ever allowed for tutor sessions — an exam test must
  // never reach the grading below, whatever else this handler grows.
  if (test.mode !== "tutor") {
    return NextResponse.json({ error: "Not a tutor session" }, { status: 400 });
  }
  if (test.status !== "in_progress") {
    return NextResponse.json({ error: "Session is finished" }, { status: 409 });
  }

  const admin = createAdminClient();

  // The correct-options read joins this batch (it depends only on the
  // question, not the lock outcome) — and ALL three fetches must succeed
  // before the irreversible lock below: grading against a partial read
  // would permanently record a wrong verdict.
  const [linkRes, questionRes, correctRes] = await Promise.all([
    admin
      .from("test_questions")
      .select("option_order")
      .eq("test_id", id)
      .eq("question_id", questionId)
      .maybeSingle(),
    admin
      .from("questions")
      .select("type, explanation")
      .eq("id", questionId)
      .maybeSingle(),
    admin
      .from("question_options")
      .select("id")
      .eq("question_id", questionId)
      .eq("is_correct", true),
  ]);
  if (linkRes.error || questionRes.error || correctRes.error) {
    return NextResponse.json(
      { error: "Could not check answer" },
      { status: 500 }
    );
  }
  const link = linkRes.data;
  const question = questionRes.data;

  if (!link || !question) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  // Same frozen-paper rule as finalize: see correctOptionsInTest.
  const correctOptionIds = correctOptionsInTest(
    (correctRes.data ?? []).map((o) => o.id),
    link.option_order
  );

  // The selection must come off the paper the student was actually dealt.
  const frozen = new Set<string>(link.option_order);
  if (!selectedOptionIds.every((optionId) => frozen.has(optionId))) {
    return NextResponse.json({ error: "Invalid selection" }, { status: 400 });
  }
  if (question.type !== "mcq_multi" && selectedOptionIds.length > 1) {
    return NextResponse.json({ error: "Invalid selection" }, { status: 400 });
  }

  const now = new Date().toISOString();

  // Independent of the lock outcome (either way the question is revealed
  // from here on); a cache read, never OpenAI. Tutor + revealed → the
  // explanation only, per the one gate.
  const translated = test.language
    ? translatedRevealFields(
        (await loadTranslationsFor(admin, [questionId], test.language)).get(
          questionId
        ),
        revealFieldsAllowed(test, true)
      )
    : {};

  // ── Take the reveal lock ──────────────────────────────────
  // Supabase upsert cannot express "update only if revealed_at is null", so:
  // (1) guarded update wins the lock when a staged row exists, (2) insert
  // wins it when none does. Both returning nothing means another request
  // holds the lock — except for one rare interleaving where an autosave
  // creates the row between (1) and (2), so (3) retries the guarded update
  // once before concluding the question was already revealed. A DB ERROR is
  // neither outcome: it must fail the request, or a transient blip would be
  // answered as "already revealed" — serving the answer while the question
  // stays unrevealed and unanswered server-side.
  let lockWon = false;
  for (const attempt of [0, 1] as const) {
    const { data: updated, error: updateError } = await admin
      .from("test_answers")
      .update({
        selected_option_ids: selectedOptionIds,
        revealed_at: now,
        ...(timeSpentSec !== undefined ? { time_spent_sec: timeSpentSec } : {}),
        updated_at: now,
      })
      .eq("test_id", id)
      .eq("question_id", questionId)
      .is("revealed_at", null)
      .select("question_id")
      .maybeSingle();
    if (updateError) {
      return NextResponse.json(
        { error: "Could not check answer" },
        { status: 500 }
      );
    }
    if (updated) {
      lockWon = true;
      break;
    }

    if (attempt === 0) {
      const { data: inserted, error: insertError } = await admin
        .from("test_answers")
        .upsert(
          {
            test_id: id,
            question_id: questionId,
            selected_option_ids: selectedOptionIds,
            flagged: false,
            time_spent_sec: timeSpentSec ?? 0,
            revealed_at: now,
            updated_at: now,
          },
          { onConflict: "test_id,question_id", ignoreDuplicates: true }
        )
        .select("question_id")
        .maybeSingle();
      if (insertError) {
        return NextResponse.json(
          { error: "Could not check answer" },
          { status: 500 }
        );
      }
      if (inserted) {
        lockWon = true;
        break;
      }
    }
  }

  if (!lockWon) {
    // A concurrent reveal holds the lock. The attempts row it wrote is the
    // graded truth; fall back to grading the stored staged selection if that
    // write hasn't landed yet (finalize heals the gap the same way).
    const [{ data: existingAttempt }, { data: storedAnswer }] =
      await Promise.all([
        admin
          .from("attempts")
          .select("selected_option_ids, is_correct")
          .eq("test_id", id)
          .eq("question_id", questionId)
          .maybeSingle(),
        admin
          .from("test_answers")
          .select("selected_option_ids")
          .eq("test_id", id)
          .eq("question_id", questionId)
          .maybeSingle(),
      ]);

    const storedSelection =
      existingAttempt?.selected_option_ids ??
      storedAnswer?.selected_option_ids ??
      [];

    return NextResponse.json({
      questionId,
      isCorrect:
        existingAttempt?.is_correct ??
        isSelectionCorrect(storedSelection, correctOptionIds),
      selectedOptionIds: storedSelection,
      correctOptionIds,
      explanation: question.explanation,
      ...translated,
      alreadyRevealed: true,
    } satisfies RevealPayload);
  }

  const isCorrect = isSelectionCorrect(selectedOptionIds, correctOptionIds);

  // The immutable analytics row, written at reveal so streaks and weak areas
  // update even if the session is never finished. Idempotent on the same
  // conflict target finalize uses; a crash before this write is healed by
  // tutor finalize re-deriving the identical row from the locked answer.
  const { error: attemptError } = await admin.from("attempts").upsert(
    {
      test_id: id,
      user_id: user.id,
      question_id: questionId,
      selected_option_ids: selectedOptionIds,
      is_correct: isCorrect,
      time_spent_sec: timeSpentSec ?? null,
    },
    { onConflict: "test_id,question_id" }
  );
  if (attemptError) {
    console.error("reveal attempt write failed", attemptError);
  }

  return NextResponse.json({
    questionId,
    isCorrect,
    selectedOptionIds,
    correctOptionIds,
    explanation: question.explanation,
    ...translated,
    alreadyRevealed: false,
  } satisfies RevealPayload);
}
