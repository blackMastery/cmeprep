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
  subjectName: string;
  options: { id: string; label: string; isCorrect: boolean }[];
  selectedOptionIds: string[];
  /** OSCE only: the graded free-text answer (from attempts). */
  answerText: string | null;
  /** OSCE only: the admin-authored answer key. */
  modelAnswer: string | null;
  isCorrect: boolean;
  answered: boolean;
  /**
   * Private-bank content the viewer may no longer read (SPEC §4): they left
   * the org (or it lapsed), so stem/options/explanation are withheld while
   * the immutable score survives. The review UI renders a placeholder.
   */
  withheld: boolean;
};

export type SubjectBreakdown = {
  subjectName: string;
  total: number;
  correct: number;
  accuracy: number;
};

export type TestResults = {
  test: Test;
  questions: ReviewQuestion[];
  breakdown: SubjectBreakdown[];
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
  subjects: { name: string } | null;
};

/**
 * Which of these questions belong to a private bank the viewer can no longer
 * read? Empty for the overwhelmingly common all-public paper — the org query
 * only runs when an org question is actually present.
 */
async function withheldQuestionIds(
  admin: ReturnType<typeof createAdminClient>,
  questionIds: string[],
  userId: string
): Promise<Set<string>> {
  if (questionIds.length === 0) return new Set();

  const { data: orgRows } = await admin
    .from("questions")
    .select("id, subjects!inner(specialties!inner(exams!inner(org_id)))")
    .in("id", questionIds)
    .not("subjects.specialties.exams.org_id", "is", null);

  const rows = (orgRows ?? []) as unknown as {
    id: string;
    subjects: { specialties: { exams: { org_id: string | null } } };
  }[];
  if (rows.length === 0) return new Set();

  const [{ data: profile }, { data: membership }] = await Promise.all([
    admin.from("profiles").select("role").eq("id", userId).maybeSingle(),
    admin
      .from("org_members")
      .select("org_id")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (profile?.role === "admin") return new Set();

  return new Set(
    rows
      .filter((r) => r.subjects.specialties.exams.org_id !== membership?.org_id)
      .map((r) => r.id)
  );
}

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
          "id, stem, type, difficulty, image_path, explanation, subjects(name)"
        )
        .in("id", questionIds.length > 0 ? questionIds : [""]),
      admin
        .from("question_options")
        .select("id, question_id, label, is_correct")
        .in("question_id", questionIds.length > 0 ? questionIds : [""]),
      admin
        .from("attempts")
        .select("question_id, selected_option_ids, answer_text, is_correct")
        .eq("test_id", test.id)
        .eq("user_id", userId),
    ]);

  // Model answers exist only for OSCE questions; skip the query entirely on
  // the overwhelmingly common all-MCQ paper.
  const osceQuestionIds = ((questions ?? []) as unknown as QuestionRow[])
    .filter((q) => q.type === "osce")
    .map((q) => q.id);
  const { data: modelAnswers } =
    osceQuestionIds.length > 0
      ? await admin
          .from("question_model_answers")
          .select("question_id, model_answer")
          .in("question_id", osceQuestionIds)
      : { data: null };
  const modelAnswerById = new Map(
    (modelAnswers ?? []).map((m) => [m.question_id, m.model_answer])
  );

  // The admin client bypasses RLS, so the org wall must be applied HERE:
  // questions from a private bank are readable in review only while the
  // viewer is still a member of that org (platform admins excepted).
  const withheldIds = await withheldQuestionIds(admin, questionIds, userId);

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
    const withheld = withheldIds.has(q.id);

    return [
      {
        questionId: q.id,
        position: link.position,
        // Scores stay; the org's content does not leave with the member.
        stem: withheld ? "" : q.stem,
        type: q.type,
        difficulty: q.difficulty,
        imagePath: withheld ? null : q.image_path,
        explanation: withheld ? "" : q.explanation,
        subjectName: q.subjects?.name ?? "",
        options: withheld
          ? []
          : link.option_order.flatMap((id: string) => {
              const opt = optionById.get(id);
              return opt
                ? [{ id: opt.id, label: opt.label, isCorrect: opt.is_correct }]
                : [];
            }),
        selectedOptionIds: selected,
        answerText: withheld ? null : (attempt?.answer_text ?? null),
        modelAnswer: withheld ? null : (modelAnswerById.get(q.id) ?? null),
        isCorrect: attempt?.is_correct ?? false,
        // OSCE: an attempts row exists exactly when the station was graded —
        // selected_option_ids is always empty there, so length would paint
        // every graded station "Not answered".
        answered: q.type === "osce" ? attempt !== undefined : selected.length > 0,
        withheld,
      },
    ];
  });

  // Per-subject accuracy for the results bars.
  //
  // The denominator must match the headline score's, or the two contradict
  // each other. Exam mode scores correct/TOTAL — a blank is wrong. Tutor and
  // OSCE modes score correct/ANSWERED (answered = graded, for OSCE), so a
  // skipped question must not drag a subject down, and a subject with
  // nothing answered has no reading at all rather than a fabricated 0%.
  const tutorScoring = test.mode !== "exam";
  const bySubject = new Map<string, SubjectBreakdown>();
  for (const q of reviewQuestions) {
    if (tutorScoring && !q.answered) continue;
    const key = q.subjectName;
    const entry =
      bySubject.get(key) ??
      ({
        subjectName: q.subjectName,
        total: 0,
        correct: 0,
        accuracy: 0,
      } satisfies SubjectBreakdown);
    entry.total += 1;
    if (q.isCorrect) entry.correct += 1;
    bySubject.set(key, entry);
  }

  const breakdown = [...bySubject.values()]
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
