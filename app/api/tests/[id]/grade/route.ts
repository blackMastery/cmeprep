import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { gradeAnswerSchema } from "@/lib/validation";
import { getTestForUser } from "@/lib/tests";
import { loadTranslationsFor, translatedRevealFields } from "@/lib/translations";
import { languageByCode, revealFieldsAllowed } from "@/lib/translation-core";
import { judgeAnswer, osceModel } from "@/lib/openai";
import {
  buildJudgeMessages,
  osceCapWindowStart,
  OSCE_DAILY_CAP,
  validateAnswerText,
} from "@/lib/osce-grading-core";

type GradePayload = {
  questionId: string;
  isCorrect: boolean;
  answerText: string;
  modelAnswer: string;
  explanation: string;
  /** Cached translations of the two fields above, when the paper has a
   * language and a current row exists — served only with the grade, the
   * same gate the English model answer has. */
  translatedExplanation?: string;
  translatedModelAnswer?: string;
  /** True when a concurrent grade won — the STORED answer was graded. */
  alreadyRevealed: boolean;
};

/**
 * The OpenAI call alone waits up to 20s (lib/openai.ts), and the platform
 * default (10–15s) would kill this handler mid-flight — AFTER the money was
 * spent but BEFORE the osce_grading_events row is written. That row is the
 * spend log AND the daily-cap counter, so a truncated request bills a grade
 * that nothing records and the student is told to retry. Same 60s ceiling the
 * import commit route uses: safe on Hobby, within Pro.
 */
export const maxDuration = 60;

/**
 * POST /api/tests/[id]/grade — OSCE mode's "check this answer".
 *
 * The AI-judged sibling of the tutor reveal route: grades one typed answer
 * via OpenAI, locks the station (revealed_at), writes the attempts row and
 * returns the verdict + model answer. Unlike tutor, the attempts row is
 * written BEFORE the lock is taken — finalize cannot re-derive an OSCE
 * verdict locally, so a locked station must always already have one. The
 * crash window between the two writes costs at most a re-grade (one extra
 * OpenAI call), never a verdict that was shown but not recorded.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/tests/[id]/grade">
) {
  const { id } = await ctx.params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // Unlike MCQ routes, every call here spends real money (an OpenAI call) —
  // mirror the creation route's ban gate so a banned account with an open
  // session can't keep spending.
  if (user.profile.banned_at) {
    return NextResponse.json({ error: "Account suspended" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = gradeAnswerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { questionId, timeSpentSec } = parsed.data;
  const answerText = parsed.data.answerText.trim();

  const test = await getTestForUser(id, user.id);
  if (!test) {
    return NextResponse.json({ error: "Test not found" }, { status: 404 });
  }
  // SECURITY BOUNDARY: this endpoint hands out the model answer for an
  // in-progress test. That is only ever allowed for OSCE sessions — an exam
  // test must never reach the grading below, whatever else this handler
  // grows. (Tutor sessions have their own boundary in the reveal route.)
  if (test.mode !== "osce") {
    return NextResponse.json({ error: "Not an OSCE session" }, { status: 400 });
  }
  if (test.status !== "in_progress") {
    return NextResponse.json({ error: "Session is finished" }, { status: 409 });
  }

  const admin = createAdminClient();

  // ALL reads must succeed before anything irreversible: grading against a
  // partial read would permanently record a wrong verdict.
  const [linkRes, questionRes, modelAnswerRes, attemptRes] = await Promise.all([
    admin
      .from("test_questions")
      .select("question_id")
      .eq("test_id", id)
      .eq("question_id", questionId)
      .maybeSingle(),
    admin
      .from("questions")
      .select("type, stem, explanation")
      .eq("id", questionId)
      .maybeSingle(),
    admin
      .from("question_model_answers")
      .select("model_answer")
      .eq("question_id", questionId)
      .maybeSingle(),
    admin
      .from("attempts")
      .select("is_correct, answer_text")
      .eq("test_id", id)
      .eq("question_id", questionId)
      .maybeSingle(),
  ]);
  if (
    linkRes.error ||
    questionRes.error ||
    modelAnswerRes.error ||
    attemptRes.error
  ) {
    return NextResponse.json(
      { error: "Could not grade answer" },
      { status: 500 }
    );
  }
  const question = questionRes.data;
  if (!linkRes.data || !question || question.type !== "osce") {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }
  const modelAnswer = modelAnswerRes.data?.model_answer;
  if (!modelAnswer) {
    // Content bug: a published OSCE question must carry its answer key
    // (publish-gate enforces this) — nothing the student can fix.
    console.error("osce question missing model answer", { questionId });
    return NextResponse.json(
      { error: "This station can't be graded right now" },
      { status: 500 }
    );
  }

  // A cache read, never OpenAI: the paper's translation of this station,
  // served alongside the grade under the grade's own gate (OSCE + graded →
  // explanation and model answer, per the one rule).
  const translatedFields = test.language
    ? translatedRevealFields(
        (await loadTranslationsFor(admin, [questionId], test.language)).get(
          questionId
        ),
        revealFieldsAllowed(test, true)
      )
    : {};

  // A station that already has a verdict is immutable — double-clicks and
  // second tabs get the stored outcome back, whatever they typed since.
  const existing = attemptRes.data;
  if (existing) {
    // Heal the crash window first: a verdict whose lock write failed leaves
    // the station rendering ungraded on resume (loadOsceRevealData keys off
    // revealed_at) while finalize still scores its attempt. Guarded update +
    // insert fallback, so an intact lock keeps its original timestamp.
    const healedAt = new Date().toISOString();
    const { data: healed, error: healError } = await admin
      .from("test_answers")
      .update({
        selected_option_ids: [],
        answer_text: existing.answer_text ?? "",
        revealed_at: healedAt,
        updated_at: healedAt,
      })
      .eq("test_id", id)
      .eq("question_id", questionId)
      .is("revealed_at", null)
      .select("question_id")
      .maybeSingle();
    if (!healError && !healed) {
      await admin.from("test_answers").upsert(
        {
          test_id: id,
          question_id: questionId,
          selected_option_ids: [],
          answer_text: existing.answer_text ?? "",
          flagged: false,
          revealed_at: healedAt,
          updated_at: healedAt,
        },
        { onConflict: "test_id,question_id", ignoreDuplicates: true }
      );
    }

    return NextResponse.json({
      questionId,
      isCorrect: existing.is_correct,
      answerText: existing.answer_text ?? "",
      modelAnswer,
      explanation: question.explanation,
      ...translatedFields,
      alreadyRevealed: true,
    } satisfies GradePayload);
  }

  const guard = validateAnswerText(answerText);
  if (guard) {
    return NextResponse.json({ error: guard }, { status: 400 });
  }

  // ── Daily cap ─────────────────────────────────────────────
  // Successful grades only (failed calls were told to retry). Soft under
  // concurrency: two in-flight grades at 49 can land 51 — acceptable, this
  // caps spend, it doesn't meter billing.
  const { count, error: capError } = await admin
    .from("osce_grading_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .not("verdict", "is", null)
    .gte("created_at", osceCapWindowStart(new Date()));
  if (capError) {
    return NextResponse.json(
      { error: "Could not grade answer" },
      { status: 500 }
    );
  }
  if ((count ?? 0) >= OSCE_DAILY_CAP) {
    // Keep the typed answer so nothing is lost overnight.
    await stageAnswer(admin, id, questionId, answerText, timeSpentSec);
    return NextResponse.json(
      {
        error: `You've reached today's limit of ${OSCE_DAILY_CAP} graded stations. It resets at midnight.`,
      },
      { status: 429 }
    );
  }

  // ── The judge call ────────────────────────────────────────
  const result = await judgeAnswer(
    buildJudgeMessages({
      stem: question.stem,
      modelAnswer,
      answerText,
      // A translated station is likely answered in that language.
      answerLanguage: languageByCode(test.language)?.name,
    })
  );

  // Every call lands in the audit log — verdict or failure. Spend tracking
  // and dispute forensics both hang off this row; the raw AI output lives
  // ONLY here, never in anything a student can read.
  const { error: eventError } = await admin.from("osce_grading_events").insert({
    user_id: user.id,
    test_id: id,
    question_id: questionId,
    answer_text: answerText,
    verdict: result.ok ? result.verdict : null,
    model: result.ok ? result.model : osceModel(),
    prompt_tokens: result.ok ? result.promptTokens : null,
    completion_tokens: result.ok ? result.completionTokens : null,
    duration_ms: result.durationMs,
    error: result.ok ? null : result.error,
    raw_response: result.raw,
  });
  if (eventError) {
    console.error("osce grading event write failed", eventError);
  }

  if (!result.ok) {
    await stageAnswer(admin, id, questionId, answerText, timeSpentSec);
    return NextResponse.json(
      {
        error:
          "Couldn't grade this answer just now — your text is saved, try again.",
      },
      { status: 502 }
    );
  }

  const isCorrect = result.verdict === "correct";
  const now = new Date().toISOString();

  // Attempts FIRST (see the route comment). Upsert on the same conflict
  // target as finalize; a concurrent grade that beat us simply wins.
  const { error: attemptError } = await admin.from("attempts").upsert(
    {
      test_id: id,
      user_id: user.id,
      question_id: questionId,
      selected_option_ids: [],
      answer_text: answerText,
      is_correct: isCorrect,
      time_spent_sec: timeSpentSec ?? null,
    },
    { onConflict: "test_id,question_id", ignoreDuplicates: true }
  );
  if (attemptError) {
    // The verdict was paid for but can't be recorded — surface as retryable
    // rather than showing a grade that stats will never see.
    console.error("osce attempt write failed", attemptError);
    return NextResponse.json(
      {
        error:
          "Couldn't grade this answer just now — your text is saved, try again.",
      },
      { status: 502 }
    );
  }

  // The station lock. Losing it is fine — the attempts row (ours or the
  // winner's) is already the graded truth; serve whatever is stored.
  const { data: locked, error: lockError } = await admin
    .from("test_answers")
    .upsert(
      {
        test_id: id,
        question_id: questionId,
        selected_option_ids: [],
        answer_text: answerText,
        // Deliberately cleared: a graded station can't be "flagged to
        // revisit", and the palette hides flags on revealed stations anyway.
        flagged: false,
        time_spent_sec: timeSpentSec ?? 0,
        revealed_at: now,
        updated_at: now,
      },
      { onConflict: "test_id,question_id" }
    )
    .select("question_id")
    .maybeSingle();
  if (lockError || !locked) {
    console.error("osce station lock failed", lockError);
  }

  const { data: finalAttempt } = await admin
    .from("attempts")
    .select("is_correct, answer_text")
    .eq("test_id", id)
    .eq("question_id", questionId)
    .maybeSingle();

  return NextResponse.json({
    questionId,
    isCorrect: finalAttempt?.is_correct ?? isCorrect,
    answerText: finalAttempt?.answer_text ?? answerText,
    modelAnswer,
    explanation: question.explanation,
    ...translatedFields,
    alreadyRevealed: false,
  } satisfies GradePayload);
}

/** Best-effort staging so a capped/failed grade never loses typed text.
 * Never clobbers a revealed row (the graded truth lives in attempts). */
async function stageAnswer(
  admin: ReturnType<typeof createAdminClient>,
  testId: string,
  questionId: string,
  answerText: string,
  timeSpentSec: number | undefined
) {
  const now = new Date().toISOString();
  const { data: updated, error } = await admin
    .from("test_answers")
    .update({
      answer_text: answerText,
      ...(timeSpentSec !== undefined ? { time_spent_sec: timeSpentSec } : {}),
      updated_at: now,
    })
    .eq("test_id", testId)
    .eq("question_id", questionId)
    .is("revealed_at", null)
    .select("question_id")
    .maybeSingle();
  if (!error && !updated) {
    await admin.from("test_answers").upsert(
      {
        test_id: testId,
        question_id: questionId,
        selected_option_ids: [],
        answer_text: answerText,
        flagged: false,
        time_spent_sec: timeSpentSec ?? 0,
        updated_at: now,
      },
      { onConflict: "test_id,question_id", ignoreDuplicates: true }
    );
  }
}
