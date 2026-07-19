import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { correctOptionsInTest, scoreTest } from "@/lib/scoring";
import type {
  Difficulty,
  QuestionType,
  Test,
  TestStatus,
} from "@/lib/supabase/types";

/** Network grace so a submit fired at 00:00 isn't rejected in flight. */
export const SUBMIT_GRACE_SEC = 30;

export type TakeQuestion = {
  questionId: string;
  position: number;
  stem: string;
  type: QuestionType;
  difficulty: Difficulty;
  imagePath: string | null;
  topicName: string;
  subjectName: string;
  /** Options in the order frozen for this test. Never includes correctness. */
  options: { id: string; label: string }[];
  selectedOptionIds: string[];
  flagged: boolean;
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
  topics: { name: string; subjects: { name: string } | null } | null;
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
 * this payload is safe to send to an in-progress client.
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
        .select(
          "id, stem, type, difficulty, image_path, topics(name, subjects(name))"
        )
        .in("id", questionIds),
      admin
        .from("question_options")
        .select("id, question_id, label")
        .in("question_id", questionIds),
      admin
        .from("test_answers")
        .select("question_id, selected_option_ids, flagged")
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

  const take: TakeQuestion[] = links.flatMap((link) => {
    const q = questionById.get(link.question_id);
    if (!q) return [];

    const answer = answerByQuestion.get(link.question_id);

    return [
      {
        questionId: q.id,
        position: link.position,
        stem: q.stem,
        type: q.type,
        difficulty: q.difficulty,
        imagePath: q.image_path,
        topicName: q.topics?.name ?? "",
        subjectName: q.topics?.subjects?.name ?? "",
        options: link.option_order.flatMap((id: string) => {
          const opt = optionById.get(id);
          return opt ? [{ id: opt.id, label: opt.label }] : [];
        }),
        selectedOptionIds: answer?.selected_option_ids ?? [],
        flagged: answer?.flagged ?? false,
      },
    ];
  });

  return { test, questions: take, serverNow: new Date().toISOString() };
}

export function isExpired(test: Test, graceSec = 0): boolean {
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

  const [{ data: links }, { data: staged }] = await Promise.all([
    // option_order is needed, not just question_id — see correctOptionsInTest.
    admin
      .from("test_questions")
      .select("question_id, option_order")
      .eq("test_id", testId),
    admin
      .from("test_answers")
      .select("question_id, selected_option_ids, time_spent_sec")
      .eq("test_id", testId),
  ]);

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

  const answers = new Map<string, string[]>(
    (staged ?? []).map((a) => [a.question_id, a.selected_option_ids])
  );
  const timeByQuestion = new Map<string, number>(
    (staged ?? []).map((a) => [a.question_id, a.time_spent_sec ?? 0])
  );

  const result = scoreTest(
    questionIds.map((id) => ({
      questionId: id,
      // Score against the paper the student actually sat, not the question as
      // it looks now — an admin may have edited it since.
      correctOptionIds: correctOptionsInTest(
        correctByQuestion.get(id) ?? [],
        frozenByQuestion.get(id) ?? []
      ),
    })),
    answers
  );

  const attemptRows = result.questions.map((q) => ({
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
