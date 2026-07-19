import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Difficulty, QuestionType, Test } from "@/lib/supabase/types";

export type ReviewQuestion = {
  questionId: string;
  position: number;
  stem: string;
  type: QuestionType;
  difficulty: Difficulty;
  imagePath: string | null;
  explanation: string;
  topicName: string;
  subjectName: string;
  options: { id: string; label: string; isCorrect: boolean }[];
  selectedOptionIds: string[];
  isCorrect: boolean;
  answered: boolean;
};

export type TopicBreakdown = {
  topicName: string;
  subjectName: string;
  total: number;
  correct: number;
  accuracy: number;
};

export type TestResults = {
  test: Test;
  questions: ReviewQuestion[];
  breakdown: TopicBreakdown[];
  correct: number;
  total: number;
  answered: number;
  durationSec: number;
};

type QuestionRow = {
  id: string;
  stem: string;
  type: QuestionType;
  difficulty: Difficulty;
  image_path: string | null;
  explanation: string;
  topics: { name: string; subjects: { name: string } | null } | null;
};

/**
 * Full results including correct answers and explanations.
 *
 * ONLY call this for a test that is no longer in progress — the caller must
 * check `status`. This is the read path that intentionally exposes
 * correctness, so gating it is the whole point.
 */
export async function getTestResults(
  test: Test,
  userId: string
): Promise<TestResults> {
  const admin = createAdminClient();

  const { data: links } = await admin
    .from("test_questions")
    .select("question_id, position, option_order")
    .eq("test_id", test.id)
    .order("position");

  const questionIds = (links ?? []).map((l) => l.question_id);

  const [{ data: questions }, { data: options }, { data: attempts }] =
    await Promise.all([
      admin
        .from("questions")
        .select(
          "id, stem, type, difficulty, image_path, explanation, topics(name, subjects(name))"
        )
        .in("id", questionIds.length > 0 ? questionIds : [""]),
      admin
        .from("question_options")
        .select("id, question_id, label, is_correct")
        .in("question_id", questionIds.length > 0 ? questionIds : [""]),
      admin
        .from("attempts")
        .select("question_id, selected_option_ids, is_correct")
        .eq("test_id", test.id)
        .eq("user_id", userId),
    ]);

  const questionById = new Map(
    ((questions ?? []) as unknown as QuestionRow[]).map((q) => [q.id, q])
  );
  const optionById = new Map((options ?? []).map((o) => [o.id, o]));
  const attemptByQuestion = new Map(
    (attempts ?? []).map((a) => [a.question_id, a])
  );

  const reviewQuestions: ReviewQuestion[] = (links ?? []).flatMap((link) => {
    const q = questionById.get(link.question_id);
    if (!q) return [];

    const attempt = attemptByQuestion.get(link.question_id);
    const selected = attempt?.selected_option_ids ?? [];

    return [
      {
        questionId: q.id,
        position: link.position,
        stem: q.stem,
        type: q.type,
        difficulty: q.difficulty,
        imagePath: q.image_path,
        explanation: q.explanation,
        topicName: q.topics?.name ?? "",
        subjectName: q.topics?.subjects?.name ?? "",
        options: link.option_order.flatMap((id: string) => {
          const opt = optionById.get(id);
          return opt
            ? [{ id: opt.id, label: opt.label, isCorrect: opt.is_correct }]
            : [];
        }),
        selectedOptionIds: selected,
        isCorrect: attempt?.is_correct ?? false,
        answered: selected.length > 0,
      },
    ];
  });

  // Per-topic accuracy for the results bars
  const byTopic = new Map<string, TopicBreakdown>();
  for (const q of reviewQuestions) {
    const key = `${q.subjectName}::${q.topicName}`;
    const entry =
      byTopic.get(key) ??
      ({
        topicName: q.topicName,
        subjectName: q.subjectName,
        total: 0,
        correct: 0,
        accuracy: 0,
      } satisfies TopicBreakdown);
    entry.total += 1;
    if (q.isCorrect) entry.correct += 1;
    byTopic.set(key, entry);
  }

  const breakdown = [...byTopic.values()]
    .map((b) => ({
      ...b,
      accuracy: b.total === 0 ? 0 : Math.round((b.correct / b.total) * 100),
    }))
    .sort((a, b) => a.accuracy - b.accuracy);

  const durationSec = test.submitted_at
    ? Math.max(
        0,
        Math.round(
          (new Date(test.submitted_at).getTime() -
            new Date(test.started_at).getTime()) /
            1000
        )
      )
    : 0;

  return {
    test,
    questions: reviewQuestions,
    breakdown,
    correct: reviewQuestions.filter((q) => q.isCorrect).length,
    total: reviewQuestions.length,
    answered: reviewQuestions.filter((q) => q.answered).length,
    durationSec,
  };
}
