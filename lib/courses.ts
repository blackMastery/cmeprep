import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  byPosition,
  courseCompletion,
  DEFAULT_PASS_PCT,
  firstIncompleteLessonId,
  gradeCourseQuiz,
  unlockedModuleIds,
  type CourseCompletion,
} from "@/lib/courses-core";
import { COURSE_CONTENT_BUCKET } from "@/lib/storage";
import type {
  Course,
  CourseLesson,
  CourseModule,
  CourseQuizAttempt,
} from "@/lib/supabase/types";

/**
 * Learner-side course reads + the two learner writes (mark complete, submit
 * quiz). ALL reads go through the RLS client — visibility (published, or
 * draft-for-admin preview) and soft-delete filtering are the policies' job,
 * so this module never restates them. The admin client appears only where
 * RLS is deliberately in the way: reading is_correct to grade, minting
 * signed URLs on the private bucket, and writing progress/attempt rows
 * (clients have no insert policies — the unlock rule checked HERE is the
 * reason, see course-spec.md §2).
 */

// Signed-URL lifetimes. Video is generous so seeking keeps working through a
// long session; everything else is short. No refresh logic in v1 (spec §7).
const VIDEO_URL_TTL_SEC = 2 * 60 * 60;
const FILE_URL_TTL_SEC = 15 * 60;
const COVER_URL_TTL_SEC = 60 * 60;

/**
 * Tree lessons deliberately omit body_md: the tree is fetched for list and
 * navigation surfaces (catalog, syllabus, dashboard card), and shipping
 * every lesson's markdown there scales the dashboard by total catalog text.
 * The lesson player fetches the one body it renders (getLessonView).
 */
export type TreeLesson = Omit<CourseLesson, "body_md">;

export type ModuleWithLessons = {
  module: CourseModule;
  lessons: TreeLesson[];
};

export type CourseTree = {
  course: Course;
  modules: ModuleWithLessons[];
  /** Lesson ids completed by THIS user (quiz pass rows included). */
  completed: Set<string>;
  unlocked: Set<string>;
  completion: CourseCompletion;
  continueLessonId: string | null;
};

type CourseRow = Course & {
  course_modules: (CourseModule & { course_lessons: TreeLesson[] })[];
};

const TREE_SELECT =
  "*, course_modules(*, course_lessons(id, module_id, title, kind, position, file_path, file_size, pass_pct, created_at, updated_at, deleted_at))";

function shapeTree(row: CourseRow, completed: Set<string>): CourseTree {
  const { course_modules: rawModules, ...course } = row;
  const modules = byPosition(rawModules).map((m) => {
    const { course_lessons: rawLessons, ...module } = m;
    return { module, lessons: byPosition(rawLessons) };
  });

  const coreModules = modules.map((m) => ({
    id: m.module.id,
    lessons: m.lessons.map((l) => ({ id: l.id, kind: l.kind })),
  }));

  return {
    course,
    modules,
    completed,
    unlocked: unlockedModuleIds(coreModules, completed),
    completion: courseCompletion(coreModules, completed),
    continueLessonId: firstIncompleteLessonId(coreModules, completed),
  };
}

async function completedLessonIds(userId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("course_lesson_progress")
    .select("lesson_id")
    .eq("user_id", userId);
  return new Set((data ?? []).map((r) => r.lesson_id));
}

// ── catalog ─────────────────────────────────────────────────

export type CourseCard = {
  course: Course;
  coverUrl: string | null;
  completion: CourseCompletion;
  started: boolean;
};

export async function listCourseCards(userId: string): Promise<CourseCard[]> {
  const supabase = await createClient();
  const [{ data: rows }, completed] = await Promise.all([
    supabase.from("courses").select(TREE_SELECT).eq("status", "published"),
    completedLessonIds(userId),
  ]);

  const trees = (rows ?? []).map((row) =>
    shapeTree(row as unknown as CourseRow, completed)
  );
  trees.sort((a, b) => a.course.title.localeCompare(b.course.title));

  const coverUrls = await signedCoverUrls(trees.map((t) => t.course));

  return trees.map((t) => ({
    course: t.course,
    coverUrl: coverUrls.get(t.course.id) ?? null,
    completion: t.completion,
    started: t.completion.completedLessons > 0,
  }));
}

/** Batch-sign covers — one Storage round trip for the whole catalog. */
async function signedCoverUrls(
  courses: Course[]
): Promise<Map<string, string>> {
  const withCover = courses.filter((c) => c.cover_path !== null);
  if (withCover.length === 0) return new Map();

  const { data } = await createAdminClient()
    .storage.from(COURSE_CONTENT_BUCKET)
    .createSignedUrls(
      withCover.map((c) => c.cover_path as string),
      COVER_URL_TTL_SEC
    );

  const byPath = new Map(
    (data ?? [])
      .filter((r) => r.signedUrl && !r.error)
      .map((r) => [r.path, r.signedUrl])
  );
  return new Map(
    withCover
      .map((c) => [c.id, byPath.get(c.cover_path as string)] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
}

// ── course overview / lesson player ─────────────────────────

/** Null when the course doesn't exist or RLS hides it (draft, deleted). */
export async function getCourseTree(
  courseId: string,
  userId: string
): Promise<CourseTree | null> {
  const supabase = await createClient();
  const [{ data: row }, completed] = await Promise.all([
    supabase
      .from("courses")
      .select(TREE_SELECT)
      .eq("id", courseId)
      .maybeSingle(),
    completedLessonIds(userId),
  ]);
  if (!row) return null;
  return shapeTree(row as unknown as CourseRow, completed);
}

/**
 * The cheap shared guard for reads AND writes: locate the lesson in the
 * tree and compute lock/completion state — nothing else. The write paths
 * (mark complete, quiz submit) stop here; only the lesson PAGE goes on to
 * mint signed URLs and load quiz/attempt data.
 */
type LessonGate = {
  tree: CourseTree;
  flat: { module: CourseModule; lesson: TreeLesson }[];
  index: number;
  module: CourseModule;
  lesson: TreeLesson;
  locked: boolean;
  completed: boolean;
};

async function getLessonGate(
  courseId: string,
  lessonId: string,
  userId: string
): Promise<LessonGate | null> {
  const tree = await getCourseTree(courseId, userId);
  if (!tree) return null;

  const flat = tree.modules.flatMap((m) =>
    m.lessons.map((lesson) => ({ module: m.module, lesson }))
  );
  const index = flat.findIndex((f) => f.lesson.id === lessonId);
  if (index < 0) return null;

  const { module, lesson } = flat[index];
  return {
    tree,
    flat,
    index,
    module,
    lesson,
    locked: !tree.unlocked.has(module.id),
    completed: tree.completed.has(lesson.id),
  };
}

export type QuizQuestionView = {
  id: string;
  promptMd: string;
  options: { id: string; label: string }[];
};

export type LessonView = {
  tree: CourseTree;
  module: CourseModule;
  lesson: CourseLesson;
  locked: boolean;
  completed: boolean;
  prevLessonId: string | null;
  /** Null at the end of the course OR when next crosses into a locked module. */
  nextLessonId: string | null;
  /** Signed URL for video/image/pdf lessons; null for text/quiz/locked. */
  fileUrl: string | null;
  /** Quiz lessons only (and only when unlocked): prompts + safe options. */
  quiz: QuizQuestionView[] | null;
  attempts: Pick<CourseQuizAttempt, "id" | "score_pct" | "passed" | "created_at">[];
};

export async function getLessonView(
  courseId: string,
  lessonId: string,
  userId: string
): Promise<LessonView | null> {
  const gate = await getLessonGate(courseId, lessonId, userId);
  if (!gate) return null;
  const { tree, flat, index, module, lesson, locked, completed } = gate;

  const next = flat[index + 1] ?? null;
  const nextUnlocked = next !== null && tree.unlocked.has(next.module.id);

  // A locked lesson renders only its title + locked notice: no body, no
  // signed URL, no quiz questions. THIS is the server-side enforcement of
  // the unlock rule on the read path — the syllabus UI merely mirrors it.
  const noContent: [string | null, string | null, QuizQuestionView[] | null, LessonView["attempts"]] =
    [null, null, null, []];
  const [bodyMd, fileUrl, quiz, attempts] = locked
    ? noContent
    : await Promise.all([
        lessonBody(lesson.id),
        signedLessonFileUrl(lesson),
        lesson.kind === "quiz" ? quizQuestions(lesson.id) : null,
        lesson.kind === "quiz" ? attemptHistory(userId, lesson.id) : [],
      ]);

  return {
    tree,
    module,
    lesson: { ...lesson, body_md: bodyMd },
    locked,
    completed,
    prevLessonId: flat[index - 1]?.lesson.id ?? null,
    nextLessonId: nextUnlocked ? next.lesson.id : null,
    fileUrl,
    quiz,
    attempts,
  };
}

/** The one body the player renders — trees deliberately exclude body_md. */
async function lessonBody(lessonId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("course_lessons")
    .select("body_md")
    .eq("id", lessonId)
    .maybeSingle();
  return data?.body_md ?? null;
}

async function signedLessonFileUrl(
  lesson: TreeLesson
): Promise<string | null> {
  if (!lesson.file_path) return null;
  const ttl = lesson.kind === "video" ? VIDEO_URL_TTL_SEC : FILE_URL_TTL_SEC;
  const { data } = await createAdminClient()
    .storage.from(COURSE_CONTENT_BUCKET)
    .createSignedUrl(lesson.file_path, ttl);
  return data?.signedUrl ?? null;
}

/** RLS client on purpose: the questions policy + public-options view shape
 * what a learner may see; is_correct stays server-side until grading. */
async function quizQuestions(lessonId: string): Promise<QuizQuestionView[]> {
  const supabase = await createClient();
  const { data: questions } = await supabase
    .from("course_questions")
    .select("id, prompt_md, position")
    .eq("lesson_id", lessonId);
  const sorted = byPosition(questions ?? []);
  if (sorted.length === 0) return [];

  // Scoped to these questions — an unfiltered view select would scan the
  // whole catalog and silently truncate at PostgREST's max_rows.
  const { data: options } = await supabase
    .from("course_question_options_public")
    .select("*")
    .in(
      "question_id",
      sorted.map((q) => q.id)
    );

  return sorted.map((q) => ({
    id: q.id,
    promptMd: q.prompt_md,
    options: byPosition(
      (options ?? []).filter((o) => o.question_id === q.id)
    ).map((o) => ({ id: o.id, label: o.label })),
  }));
}

async function attemptHistory(userId: string, lessonId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("course_quiz_attempts")
    .select("id, score_pct, passed, created_at")
    .eq("user_id", userId)
    .eq("lesson_id", lessonId)
    .order("created_at", { ascending: false })
    .limit(10);
  return data ?? [];
}

// ── learner writes ──────────────────────────────────────────

export type CourseActionResult = { error?: string; success?: string } | null;

/**
 * Mark a content lesson complete. Idempotent; un-marking doesn't exist.
 * Re-checks visibility AND the unlock rule server-side — the button in the
 * UI is not the enforcement.
 */
export async function completeContentLesson(
  userId: string,
  courseId: string,
  lessonId: string
): Promise<CourseActionResult> {
  const gate = await getLessonGate(courseId, lessonId, userId);
  if (!gate) return { error: "That lesson no longer exists." };
  if (gate.locked) return { error: "Pass the earlier module quiz first." };
  if (gate.lesson.kind === "quiz") {
    return { error: "Quizzes are completed by passing them." };
  }
  if (gate.completed) return null;

  const { error } = await createAdminClient()
    .from("course_lesson_progress")
    .upsert(
      { user_id: userId, lesson_id: lessonId },
      { onConflict: "user_id,lesson_id", ignoreDuplicates: true }
    );
  if (error) return { error: "Could not save your progress. Try again." };
  return null;
}

export type QuizFeedback = {
  scorePct: number;
  passed: boolean;
  passPct: number;
  results: {
    questionId: string;
    pickedOptionId: string | null;
    correctOptionId: string | null;
    correct: boolean;
    explanationMd: string;
  }[];
};

/**
 * Grade a quiz submission in one server round trip: read correctness with
 * the admin client, write the immutable attempt row, and (on pass) the
 * progress row that IS the unlock. Feedback — correct answers and
 * explanations — is only ever returned from here, post-grade (spec §2).
 */
export async function submitCourseQuiz(
  userId: string,
  courseId: string,
  lessonId: string,
  submission: { questionId: string; optionId: string }[]
): Promise<{ error: string } | { feedback: QuizFeedback }> {
  const gate = await getLessonGate(courseId, lessonId, userId);
  if (!gate) return { error: "That quiz no longer exists." };
  if (gate.locked) return { error: "Pass the earlier module quiz first." };
  if (gate.lesson.kind !== "quiz") return { error: "Not a quiz lesson." };

  const admin = createAdminClient();
  const { data, error: readError } = await admin
    .from("course_questions")
    .select("id, position, explanation_md, course_question_options(id, is_correct, deleted_at)")
    .eq("lesson_id", lessonId)
    .is("deleted_at", null);
  // A failed read must NOT grade as 0% — the attempt table is append-only
  // and a spurious fail would sit in the learner's history forever.
  if (readError) return { error: "Could not grade the quiz. Try again." };

  // Hand-maintained Database type carries no relationship metadata, so
  // embedded selects need the usual unknown hop.
  const rows = (data ?? []) as unknown as {
    id: string;
    position: number;
    explanation_md: string;
    course_question_options: {
      id: string;
      is_correct: boolean;
      deleted_at: string | null;
    }[];
  }[];

  const questions = byPosition(rows).map((q) => ({
    id: q.id,
    explanationMd: q.explanation_md,
    correctOptionId:
      q.course_question_options.find((o) => o.deleted_at === null && o.is_correct)
        ?.id ?? null,
  }));

  const graded = gradeCourseQuiz(
    questions.map((q) => ({ id: q.id, correctOptionId: q.correctOptionId })),
    submission,
    gate.lesson.pass_pct
  );

  const { error: attemptError } = await admin.from("course_quiz_attempts").insert({
    user_id: userId,
    lesson_id: lessonId,
    score_pct: graded.scorePct,
    passed: graded.passed,
    answers: graded.answers,
  });
  if (attemptError) return { error: "Could not record your attempt. Try again." };

  if (graded.passed) {
    // The progress row is the unlock — grading writes it so completion
    // queries never special-case quizzes. Failure here would strand a
    // passing attempt, so surface it rather than swallowing.
    const { error: progressError } = await admin
      .from("course_lesson_progress")
      .upsert(
        { user_id: userId, lesson_id: lessonId },
        { onConflict: "user_id,lesson_id", ignoreDuplicates: true }
      );
    if (progressError) {
      return { error: "Your attempt was saved but progress didn't update — reload and try again." };
    }
  }

  const pickByQuestion = new Map(graded.answers.map((a) => [a.question_id, a]));
  return {
    feedback: {
      scorePct: graded.scorePct,
      passed: graded.passed,
      passPct: gate.lesson.pass_pct ?? DEFAULT_PASS_PCT,
      results: questions.map((q) => {
        const answer = pickByQuestion.get(q.id);
        return {
          questionId: q.id,
          pickedOptionId: answer?.option_id || null,
          correctOptionId: q.correctOptionId,
          correct: answer?.correct ?? false,
          explanationMd: q.explanationMd,
        };
      }),
    },
  };
}

// ── dashboard ───────────────────────────────────────────────

export type ContinueLearningCard = {
  courseId: string;
  title: string;
  completion: CourseCompletion;
  continueLessonId: string | null;
};

/**
 * The most recently active in-progress course, or null when the learner has
 * never started one (dashboard hides the card). "Recently active" = latest
 * progress row whose lesson still exists in a published course.
 *
 * Progress is read FIRST and the catalog only when it's non-empty — this
 * runs on every dashboard render, and most users have never started a
 * course; they must pay one cheap indexed read, not a catalog scan.
 */
export async function continueLearning(
  userId: string
): Promise<ContinueLearningCard | null> {
  const supabase = await createClient();
  const { data: progress } = await supabase
    .from("course_lesson_progress")
    .select("lesson_id, completed_at")
    .eq("user_id", userId)
    .order("completed_at", { ascending: false });
  if (!progress?.length) return null;

  const { data: rows } = await supabase
    .from("courses")
    .select(TREE_SELECT)
    .eq("status", "published");
  if (!rows?.length) return null;

  const completed = new Set(progress.map((r) => r.lesson_id));
  const trees = rows.map((row) => shapeTree(row as unknown as CourseRow, completed));

  const courseByLesson = new Map<string, (typeof trees)[number]>();
  for (const tree of trees) {
    for (const m of tree.modules) {
      for (const lesson of m.lessons) courseByLesson.set(lesson.id, tree);
    }
  }

  for (const row of progress) {
    const tree = courseByLesson.get(row.lesson_id);
    if (!tree || tree.completion.done) continue;
    return {
      courseId: tree.course.id,
      title: tree.course.title,
      completion: tree.completion,
      continueLessonId: tree.continueLessonId,
    };
  }
  return null;
}
