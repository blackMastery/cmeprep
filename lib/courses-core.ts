import { COURSE_FILE_RULES, type CourseFileKind } from "@/lib/storage";
import type { CourseLessonKind, CourseQuizAnswer } from "@/lib/supabase/types";

/**
 * Pure course rules (course-spec.md) — unlock computation, completion math,
 * quiz grading, upload caps and publish validation. The sibling lib/courses.ts
 * / lib/admin/courses.ts do the DB work; every rule here is stated once and
 * unit-tested in tests/unit/courses-core.test.ts.
 *
 * All inputs are assumed pre-filtered to NON-DELETED rows in stored order —
 * the server modules query with `deleted_at is null` + `order by position`.
 */

export type CoreLesson = { id: string; kind: CourseLessonKind };
export type CoreModule<L extends CoreLesson = CoreLesson> = {
  id: string;
  lessons: L[];
};

/**
 * THE ordering rule for courses/modules/lessons/questions/options. The id
 * tiebreak matters: positions may tie after edits, and without a
 * deterministic tiebreak the admin builder and the learner syllabus could
 * disagree about lesson order.
 */
export function byPosition<T extends { position: number; id: string }>(
  rows: readonly T[]
): T[] {
  return [...rows].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id)
  );
}

/**
 * Neighbour reorder that renumbers EVERY sibling to its list index (the
 * plans/exams precedent) rather than swapping two positions — positions gap
 * after soft deletes, and a two-row swap against gapped values can tie two
 * rows and silently scramble the module order that drives quiz gating.
 * Null = already at the end / unknown id, nothing to write.
 */
export function reorderSiblings<T extends { position: number; id: string }>(
  siblings: readonly T[],
  id: string,
  direction: "up" | "down"
): { id: string; position: number }[] | null {
  const ordered = byPosition(siblings);
  const index = ordered.findIndex((row) => row.id === id);
  const other = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || other < 0 || other >= ordered.length) return null;
  [ordered[index], ordered[other]] = [ordered[other], ordered[index]];
  return ordered.map((row, position) => ({ id: row.id, position }));
}

/**
 * The one progression rule: module N is unlocked iff every QUIZ lesson in
 * every earlier module is complete. Content lessons never lock anything, and
 * a quiz lesson only gains a progress row by a passing attempt, so
 * `completedLessonIds` is the single input for both lesson kinds.
 * Module 1 is always unlocked. A quiz-free course unlocks entirely.
 */
export function unlockedModuleIds(
  modules: CoreModule[],
  completedLessonIds: ReadonlySet<string>
): Set<string> {
  const unlocked = new Set<string>();
  let blocked = false;
  for (const mod of modules) {
    if (!blocked) unlocked.add(mod.id);
    if (
      mod.lessons.some((l) => l.kind === "quiz" && !completedLessonIds.has(l.id))
    ) {
      blocked = true;
    }
  }
  return unlocked;
}

export type CourseCompletion = {
  completedLessons: number;
  totalLessons: number;
  /** 0–100, rounded. 0 for a lesson-less course — never NaN. */
  pct: number;
  /** True only when there is at least one lesson and all are complete. */
  done: boolean;
};

/** Derived on read, never stored — edit-in-place recomputes it (spec §6). */
export function courseCompletion(
  modules: CoreModule[],
  completedLessonIds: ReadonlySet<string>
): CourseCompletion {
  const lessons = modules.flatMap((m) => m.lessons);
  const completed = lessons.filter((l) => completedLessonIds.has(l.id)).length;
  return {
    completedLessons: completed,
    totalLessons: lessons.length,
    pct: lessons.length === 0 ? 0 : Math.round((100 * completed) / lessons.length),
    done: lessons.length > 0 && completed === lessons.length,
  };
}

/**
 * Where "Continue" lands: the first incomplete lesson in the furthest
 * reachable position — scanning unlocked modules in order. Null when the
 * course is finished (or has nothing to do); callers fall back to the
 * course overview.
 */
export function firstIncompleteLessonId(
  modules: CoreModule[],
  completedLessonIds: ReadonlySet<string>
): string | null {
  const unlocked = unlockedModuleIds(modules, completedLessonIds);
  for (const mod of modules) {
    if (!unlocked.has(mod.id)) break;
    for (const lesson of mod.lessons) {
      if (!completedLessonIds.has(lesson.id)) return lesson.id;
    }
  }
  return null;
}

// ── quiz grading ────────────────────────────────────────────

export type GradableQuestion = { id: string; correctOptionId: string | null };
export type QuizSubmission = { questionId: string; optionId: string }[];

export type GradedQuiz = {
  scorePct: number;
  passed: boolean;
  /** Snapshot rows for course_quiz_attempts.answers — graded picks only. */
  answers: CourseQuizAnswer[];
};

export const DEFAULT_PASS_PCT = 70;

/**
 * Single-best-answer, formative: an unanswered or unknown question is simply
 * wrong, never an error — the learner retakes freely. A quiz with zero
 * questions grades to 0/unpassed (spec §7: post-publish deletion of every
 * question makes the quiz un-passable until the admin fixes it), and a
 * question left without a correct option can never be scored right.
 */
export function gradeCourseQuiz(
  questions: GradableQuestion[],
  submission: QuizSubmission,
  passPct: number | null
): GradedQuiz {
  const pickByQuestion = new Map(
    submission.map((s) => [s.questionId, s.optionId])
  );

  const answers: CourseQuizAnswer[] = questions.map((q) => {
    const picked = pickByQuestion.get(q.id) ?? null;
    const correct = picked !== null && picked === q.correctOptionId;
    return { question_id: q.id, option_id: picked ?? "", correct };
  });

  const correctCount = answers.filter((a) => a.correct).length;
  const scorePct =
    questions.length === 0
      ? 0
      : Math.round((100 * correctCount) / questions.length);

  return {
    scorePct,
    passed:
      questions.length > 0 && scorePct >= (passPct ?? DEFAULT_PASS_PCT),
    answers,
  };
}

// ── upload caps ─────────────────────────────────────────────

/** Lesson kinds that carry a storage object. */
export function fileKindOf(kind: CourseLessonKind): CourseFileKind | null {
  return kind === "video" || kind === "image" || kind === "pdf" ? kind : null;
}

/**
 * Reject BEFORE minting a signed URL; the bucket's mime/size config is the
 * second layer. Returns a user-facing message, or null when acceptable.
 */
export function courseUploadProblem(
  kind: CourseFileKind,
  contentType: string,
  sizeBytes: number
): string | null {
  const rules = COURSE_FILE_RULES[kind];
  if (!rules.mimes.includes(contentType)) {
    return `That file type isn't supported here — expected ${rules.label}.`;
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "That file looks empty.";
  }
  if (sizeBytes > rules.maxBytes) {
    return `Too large — ${rules.label}.`;
  }
  return null;
}

// ── publish validation ──────────────────────────────────────

export type PublishLesson = CoreLesson & {
  title: string;
  filePath: string | null;
  /** Present for quiz lessons; option counts are of NON-DELETED options. */
  questions: { optionCount: number; correctCount: number }[];
};

/**
 * Everything that blocks publishing (spec §6), as user-facing messages.
 * Empty array = publishable. Unpublish is never validated.
 */
export function coursePublishProblems(
  modules: CoreModule<PublishLesson>[]
): string[] {
  const problems: string[] = [];
  if (modules.length === 0) problems.push("Add at least one module.");

  modules.forEach((module, mi) => {
    const where = `Module ${mi + 1}`;
    if (module.lessons.length === 0) {
      problems.push(`${where} has no lessons.`);
    }
    module.lessons.forEach((lesson) => {
      if (fileKindOf(lesson.kind) && !lesson.filePath) {
        problems.push(`${where} · "${lesson.title}" has no uploaded file.`);
      }
      if (lesson.kind === "quiz") {
        if (lesson.questions.length === 0) {
          problems.push(`${where} · "${lesson.title}" has no questions.`);
        }
        lesson.questions.forEach((q, qi) => {
          if (q.optionCount < 2 || q.correctCount !== 1) {
            problems.push(
              `${where} · "${lesson.title}" question ${qi + 1} needs at least two options with exactly one correct.`
            );
          }
        });
      }
    });
  });

  return problems;
}
