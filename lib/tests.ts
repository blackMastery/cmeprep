import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  correctOptionsInTest,
  isSelectionCorrect,
  scoreOsceOutcomes,
  scoreTest,
  scoreTutorTest,
} from "@/lib/scoring";
import type {
  Difficulty,
  QuestionType,
  Test,
  TestStatus,
} from "@/lib/supabase/types";

/** Network grace so a submit fired at 00:00 isn't rejected in flight. */
export const SUBMIT_GRACE_SEC = 30;

/** Per-question feedback served ONLY for revealed questions of a tutor or
 * OSCE test. */
export type TakeReveal = {
  isCorrect: boolean;
  /** Empty for OSCE stations — their answer key is modelAnswer. */
  correctOptionIds: string[];
  explanation: string;
  /** OSCE only: the admin-authored answer key, served once graded. */
  modelAnswer?: string;
};

export type TakeQuestion = {
  questionId: string;
  position: number;
  stem: string;
  type: QuestionType;
  difficulty: Difficulty;
  imagePath: string | null;
  subjectName: string;
  /** Options in the order frozen for this test. Never includes correctness. */
  options: { id: string; label: string }[];
  selectedOptionIds: string[];
  /** OSCE only: staged (or graded) free text. Null on MCQ questions. */
  answerText: string | null;
  flagged: boolean;
  /** Tutor/OSCE only: set once the reveal/grade endpoint graded and locked
   * the answer. MUST stay null for exam-mode tests so a client can never
   * render correctness mid-exam even by accident. */
  reveal: TakeReveal | null;
};

export type TakeState = {
  test: Test;
  questions: TakeQuestion[];
  /** Server clock at render, so the client can correct for drift. */
  serverNow: string;
};

type QuestionRow = {
  id: string;
  stem: string;
  type: QuestionType;
  difficulty: Difficulty;
  image_path: string | null;
  subjects: { name: string } | null;
};

export async function getTestForUser(
  testId: string,
  userId: string
): Promise<Test | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("tests")
    .select("*")
    .eq("id", testId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as Test) ?? null;
}

/**
 * Everything the take screen needs. Deliberately omits `is_correct` —
 * this payload is safe to send to an in-progress client. The ONE sanctioned
 * exception is loadRevealData below: questions of a TUTOR test whose answer
 * the reveal endpoint has already graded and locked.
 */
export async function getTakeState(
  testId: string,
  userId: string
): Promise<TakeState | null> {
  const admin = createAdminClient();

  const test = await getTestForUser(testId, userId);
  if (!test) return null;

  const { data: links } = await admin
    .from("test_questions")
    .select("question_id, position, option_order")
    .eq("test_id", testId)
    .order("position");

  if (!links || links.length === 0) {
    return { test, questions: [], serverNow: new Date().toISOString() };
  }

  const questionIds = links.map((l) => l.question_id);

  const [{ data: questions }, { data: options }, { data: answers }] =
    await Promise.all([
      admin
        .from("questions")
        .select("id, stem, type, difficulty, image_path, subjects(name)")
        .in("id", questionIds),
      admin
        .from("question_options")
        .select("id, question_id, label")
        .in("question_id", questionIds),
      admin
        .from("test_answers")
        .select(
          "question_id, selected_option_ids, answer_text, flagged, revealed_at"
        )
        .eq("test_id", testId),
    ]);

  const questionById = new Map(
    ((questions ?? []) as unknown as QuestionRow[]).map((q) => [q.id, q])
  );
  const optionById = new Map(
    (options ?? []).map((o) => [o.id, o as { id: string; label: string }])
  );
  const answerByQuestion = new Map(
    (answers ?? []).map((a) => [a.question_id, a])
  );

  // Each loader is gated on its own mode, so at most one does any work.
  const [revealByQuestion, osceRevealByQuestion] = await Promise.all([
    loadRevealData(admin, test, links, answers ?? []),
    loadOsceRevealData(admin, test, answers ?? []),
  ]);

  const take: TakeQuestion[] = links.flatMap((link) => {
    const q = questionById.get(link.question_id);
    if (!q) return [];

    const answer = answerByQuestion.get(link.question_id);
    const reveal = revealByQuestion.get(link.question_id);
    const osceReveal = osceRevealByQuestion.get(link.question_id);

    return [
      {
        questionId: q.id,
        position: link.position,
        stem: q.stem,
        type: q.type,
        difficulty: q.difficulty,
        imagePath: q.image_path,
        subjectName: q.subjects?.name ?? "",
        options: link.option_order.flatMap((id: string) => {
          const opt = optionById.get(id);
          return opt ? [{ id: opt.id, label: opt.label }] : [];
        }),
        // For revealed questions the attempts row is the graded truth — a
        // stale autosave racing the reveal may have clobbered the staged
        // selection, but it can never touch the attempt.
        selectedOptionIds:
          reveal?.selectedOptionIds ?? answer?.selected_option_ids ?? [],
        answerText: osceReveal?.answerText ?? answer?.answer_text ?? null,
        flagged: answer?.flagged ?? false,
        reveal: reveal
          ? {
              isCorrect: reveal.isCorrect,
              correctOptionIds: reveal.correctOptionIds,
              explanation: reveal.explanation,
            }
          : (osceReveal?.reveal ?? null),
      },
    ];
  });

  return { test, questions: take, serverNow: new Date().toISOString() };
}

/**
 * The ONE sanctioned exception to "correctness never reaches an in-progress
 * client": a TUTOR-mode question whose answer the reveal endpoint has graded
 * and locked (revealed_at set). Resume must re-open those questions in their
 * explanation state. The mode gate on the first line is a security boundary —
 * exam tests must always get an empty map.
 */
async function loadRevealData(
  admin: ReturnType<typeof createAdminClient>,
  test: Test,
  links: { question_id: string; option_order: string[] }[],
  answers: {
    question_id: string;
    selected_option_ids: string[];
    revealed_at: string | null;
  }[]
): Promise<
  Map<string, TakeReveal & { selectedOptionIds: string[] | undefined }>
> {
  const revealed = new Map<
    string,
    TakeReveal & { selectedOptionIds: string[] | undefined }
  >();
  if (test.mode !== "tutor") return revealed;

  const revealedRows = answers.filter((a) => a.revealed_at !== null);
  const revealedIds = revealedRows.map((a) => a.question_id);
  if (revealedIds.length === 0) return revealed;
  const stagedSelection = new Map(
    revealedRows.map((a) => [a.question_id, a.selected_option_ids])
  );

  const [{ data: attempts }, { data: questions }, { data: correctOptions }] =
    await Promise.all([
      admin
        .from("attempts")
        .select("question_id, selected_option_ids, is_correct")
        .eq("test_id", test.id)
        .in("question_id", revealedIds),
      admin
        .from("questions")
        .select("id, explanation")
        .in("id", revealedIds),
      admin
        .from("question_options")
        .select("id, question_id")
        .in("question_id", revealedIds)
        .eq("is_correct", true),
    ]);

  const attemptByQuestion = new Map(
    (attempts ?? []).map((a) => [a.question_id, a])
  );
  const explanationById = new Map(
    (questions ?? []).map((q) => [q.id, q.explanation as string])
  );
  const correctByQuestion = new Map<string, string[]>();
  for (const opt of correctOptions ?? []) {
    const list = correctByQuestion.get(opt.question_id) ?? [];
    list.push(opt.id);
    correctByQuestion.set(opt.question_id, list);
  }
  const frozenByQuestion = new Map(
    links.map((l) => [l.question_id, l.option_order])
  );

  for (const questionId of revealedIds) {
    // Same frozen-paper restriction as scoring — see correctOptionsInTest.
    const correctOptionIds = correctOptionsInTest(
      correctByQuestion.get(questionId) ?? [],
      frozenByQuestion.get(questionId) ?? []
    );
    // The attempt row can be missing if the reveal crashed between locking
    // and writing it (tutor finalize heals that). Grade the locked staged
    // selection rather than defaulting to incorrect — otherwise resume
    // paints a genuinely correct answer as "Incorrect" while rendering its
    // options all-green, and disagrees with the healed final score.
    const attempt = attemptByQuestion.get(questionId);
    revealed.set(questionId, {
      isCorrect:
        attempt?.is_correct ??
        isSelectionCorrect(
          stagedSelection.get(questionId) ?? [],
          correctOptionIds
        ),
      correctOptionIds,
      explanation: explanationById.get(questionId) ?? "",
      selectedOptionIds: attempt?.selected_option_ids,
    });
  }

  return revealed;
}

/**
 * The OSCE sibling of loadRevealData: graded stations of an OSCE session,
 * served from their attempts rows (verdict + graded text) plus the model
 * answer. The mode gate on the first line is a security boundary — exam
 * tests must always get an empty map, and only a GRADED station may ever
 * see its model answer. A locked row with no attempts row (a crash window
 * the grade route's attempts-first ordering makes near-impossible) is served
 * ungraded so the client simply re-grades — there is no local way to heal an
 * AI verdict.
 */
async function loadOsceRevealData(
  admin: ReturnType<typeof createAdminClient>,
  test: Test,
  answers: { question_id: string; revealed_at: string | null }[]
): Promise<Map<string, { reveal: TakeReveal; answerText: string | null }>> {
  const revealed = new Map<
    string,
    { reveal: TakeReveal; answerText: string | null }
  >();
  if (test.mode !== "osce") return revealed;

  const revealedIds = answers
    .filter((a) => a.revealed_at !== null)
    .map((a) => a.question_id);
  if (revealedIds.length === 0) return revealed;

  const [{ data: attempts }, { data: questions }, { data: modelAnswers }] =
    await Promise.all([
      admin
        .from("attempts")
        .select("question_id, is_correct, answer_text")
        .eq("test_id", test.id)
        .in("question_id", revealedIds),
      admin
        .from("questions")
        .select("id, explanation")
        .in("id", revealedIds),
      admin
        .from("question_model_answers")
        .select("question_id, model_answer")
        .in("question_id", revealedIds),
    ]);

  const explanationById = new Map(
    (questions ?? []).map((q) => [q.id, q.explanation as string])
  );
  const modelAnswerById = new Map(
    (modelAnswers ?? []).map((m) => [m.question_id, m.model_answer])
  );

  for (const attempt of attempts ?? []) {
    revealed.set(attempt.question_id, {
      reveal: {
        isCorrect: attempt.is_correct,
        correctOptionIds: [],
        explanation: explanationById.get(attempt.question_id) ?? "",
        modelAnswer: modelAnswerById.get(attempt.question_id) ?? "",
      },
      answerText: attempt.answer_text,
    });
  }

  return revealed;
}

export function isExpired(test: Test, graceSec = 0): boolean {
  // Tutor sessions (expires_at null, CHECK-constrained) never expire — this
  // is what keeps finalizeIfExpired a no-op for them on every read path.
  if (test.expires_at === null) return false;
  return Date.now() > new Date(test.expires_at).getTime() + graceSec * 1000;
}

/**
 * Score a test from its staged answers and write the immutable attempts rows.
 * Idempotent: a test that is already submitted is returned untouched, so a
 * double-click or a retried beacon cannot rewrite history.
 */
export async function finalizeTest(
  testId: string,
  userId: string,
  status: Exclude<TestStatus, "in_progress"> = "submitted"
): Promise<Test | null> {
  const admin = createAdminClient();

  const test = await getTestForUser(testId, userId);
  if (!test) return null;
  if (test.status !== "in_progress") return test;

  const tutor = test.mode === "tutor";
  const osce = test.mode === "osce";
  const revealedOnly = tutor || osce;

  const [{ data: links }, { data: allStaged }, { data: revealAttempts }] =
    await Promise.all([
      // option_order is needed, not just question_id — see correctOptionsInTest.
      admin
        .from("test_questions")
        .select("question_id, option_order")
        .eq("test_id", testId),
      admin
        .from("test_answers")
        .select("question_id, selected_option_ids, time_spent_sec, revealed_at")
        .eq("test_id", testId),
      revealedOnly
        ? admin
            .from("attempts")
            .select("question_id, selected_option_ids, is_correct")
            .eq("test_id", testId)
        : Promise.resolve({ data: null }),
    ]);

  // Tutor/OSCE: only REVEALED answers exist as far as scoring is concerned.
  // An unrevealed staged row is an in-flight selection (or un-checked typed
  // text) the user never committed — it must not be graded, and (unlike exam
  // mode) no attempts row may be written for it or for blanks: phantom wrong
  // answers would poison accuracy, weak areas and streaks.
  const staged = revealedOnly
    ? (allStaged ?? []).filter((a) => a.revealed_at !== null)
    : (allStaged ?? []);

  const questionIds = (links ?? []).map((l) => l.question_id);
  const frozenByQuestion = new Map<string, string[]>(
    (links ?? []).map((l) => [l.question_id, l.option_order])
  );

  // The ONLY place is_correct is read.
  const { data: correctOptions } = await admin
    .from("question_options")
    .select("id, question_id, is_correct")
    .in("question_id", questionIds.length > 0 ? questionIds : [""])
    .eq("is_correct", true);

  const correctByQuestion = new Map<string, string[]>();
  for (const opt of correctOptions ?? []) {
    const list = correctByQuestion.get(opt.question_id) ?? [];
    list.push(opt.id);
    correctByQuestion.set(opt.question_id, list);
  }

  // Tutor: the reveal-time attempts row is the graded truth for a revealed
  // question — a stale autosave racing the reveal can clobber the STAGED
  // selection (revealed_at intact), and grading that here would overwrite
  // the verdict the user was shown mid-session. Staged is only the fallback
  // for a reveal that crashed between its lock and its attempts write.
  const attemptSelection = new Map<string, string[]>(
    (revealAttempts ?? []).map((a) => [a.question_id, a.selected_option_ids])
  );
  const answers = new Map<string, string[]>(
    staged.map((a) => [
      a.question_id,
      (tutor ? attemptSelection.get(a.question_id) : undefined) ??
        a.selected_option_ids,
    ])
  );
  const timeByQuestion = new Map<string, number>(
    staged.map((a) => [a.question_id, a.time_spent_sec ?? 0])
  );

  const scoreQuestions = questionIds.map((id) => ({
    questionId: id,
    // Score against the paper the student actually sat, not the question as
    // it looks now — an admin may have edited it since.
    correctOptionIds: correctOptionsInTest(
      correctByQuestion.get(id) ?? [],
      frozenByQuestion.get(id) ?? []
    ),
  }));

  // Tutor score is correct/answered — blanks are allowed at Finish and must
  // not count against the user (completion is tracked separately).
  // OSCE: verdicts already live in the attempts rows written by the grade
  // route — every attempts row IS a graded station (they are written before
  // the lock). Nothing can be re-derived locally (that would take an OpenAI
  // call), so finalize only aggregates; scoreOsceOutcomes returns an empty
  // questions list precisely so no attempts writes happen below.
  const result = osce
    ? scoreOsceOutcomes(
        questionIds.length,
        (revealAttempts ?? []).map((a) => ({ isCorrect: a.is_correct }))
      )
    : tutor
      ? scoreTutorTest(scoreQuestions, answers)
      : scoreTest(scoreQuestions, answers);

  const attemptRows = result.questions
    // Tutor: attempts for revealed questions only (see `staged` above). The
    // reveal endpoint already wrote these rows; this deterministic re-upsert
    // is a no-op that also heals a reveal that crashed before its write.
    .filter((q) => !tutor || q.answered)
    .map((q) => ({
      test_id: testId,
      user_id: userId,
      question_id: q.questionId,
      selected_option_ids: q.selectedOptionIds,
      is_correct: q.isCorrect,
      time_spent_sec: timeByQuestion.get(q.questionId) ?? null,
    }));

  // Write the immutable answer log FIRST. If this fails the test must stay
  // in_progress rather than becoming a submitted test with no analytics
  // behind it — that inconsistency is unrecoverable without a backfill.
  if (attemptRows.length > 0) {
    // onConflict keeps this idempotent if a previous run partially completed.
    const { error: attemptsError } = await admin
      .from("attempts")
      .upsert(attemptRows, { onConflict: "test_id,question_id" });

    if (attemptsError) {
      throw new Error(
        `Failed to record attempts for test ${testId}: ${attemptsError.message}`
      );
    }
  }

  const { data: updated, error: updateError } = await admin
    .from("tests")
    .update({
      status,
      score: result.percentage,
      answered_questions: result.answered,
      submitted_at: new Date().toISOString(),
    })
    .eq("id", testId)
    .eq("status", "in_progress") // guard against a concurrent submit
    .select("*")
    .maybeSingle();

  if (updateError) {
    throw new Error(
      `Failed to finalize test ${testId}: ${updateError.message}`
    );
  }

  // No row back means a concurrent request finalized it first — re-read.
  return ((updated as Test) ?? (await getTestForUser(testId, userId)))!;
}

/**
 * Called by any read path. If the deadline passed while the user was away,
 * score whatever was staged rather than leaving the test hanging.
 */
export async function finalizeIfExpired(
  test: Test,
  userId: string
): Promise<Test> {
  if (test.status !== "in_progress") return test;
  if (!isExpired(test, SUBMIT_GRACE_SEC)) return test;
  const finalized = await finalizeTest(test.id, userId, "submitted");
  return finalized ?? test;
}
