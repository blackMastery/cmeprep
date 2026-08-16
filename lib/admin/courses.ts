import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  byPosition,
  coursePublishProblems,
  type PublishLesson,
} from "@/lib/courses-core";
import { COURSE_CONTENT_BUCKET } from "@/lib/storage";
import type {
  Course,
  CourseLesson,
  CourseModule,
  CourseQuestion,
  CourseQuestionOption,
} from "@/lib/supabase/types";

/**
 * Admin-side course queries. Reads use the service-role client — the builder
 * must see drafts and is reached only behind requireAdmin() (the actions
 * repeat that check themselves; layouts don't cover Server Actions).
 *
 * Soft-deleted MODULES/LESSONS/QUESTIONS are filtered out here and never
 * resurface in the builder; only whole COURSES get a restore affordance
 * (matching the questions list). Deleting a course leaves children rows
 * untouched — visibility hangs off the course row.
 */

export type AdminCourseListItem = {
  course: Course;
  lessonCount: number;
};

export async function listCoursesForAdmin(options: {
  includeDeleted: boolean;
}): Promise<AdminCourseListItem[]> {
  const admin = createAdminClient();
  let query = admin
    .from("courses")
    .select(
      "*, course_modules(id, deleted_at, course_lessons(id, deleted_at))"
    )
    .order("created_at", { ascending: false });
  if (!options.includeDeleted) query = query.is("deleted_at", null);

  const { data } = await query;
  return (data ?? []).map((row) => {
    const { course_modules: modules, ...course } = row as unknown as Course & {
      course_modules: {
        id: string;
        deleted_at: string | null;
        course_lessons: { id: string; deleted_at: string | null }[];
      }[];
    };
    const lessonCount = modules
      .filter((m) => m.deleted_at === null)
      .flatMap((m) => m.course_lessons)
      .filter((l) => l.deleted_at === null).length;
    return { course, lessonCount };
  });
}

export type BuilderQuestion = CourseQuestion & {
  options: CourseQuestionOption[];
};
export type BuilderLesson = CourseLesson & { questions: BuilderQuestion[] };
export type BuilderModule = CourseModule & { lessons: BuilderLesson[] };
export type BuilderCourse = {
  course: Course;
  modules: BuilderModule[];
  /** Empty array = publishable. */
  publishProblems: string[];
};

export async function getCourseBuilder(
  courseId: string
): Promise<BuilderCourse | null> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("courses")
    .select(
      "*, course_modules(*, course_lessons(*, course_questions(*, course_question_options(*))))"
    )
    .eq("id", courseId)
    .maybeSingle();
  if (!row) return null;

  const { course_modules: rawModules, ...course } = row as unknown as Course & {
    course_modules: (CourseModule & {
      course_lessons: (CourseLesson & {
        course_questions: (CourseQuestion & {
          course_question_options: CourseQuestionOption[];
        })[];
      })[];
    })[];
  };

  const modules: BuilderModule[] = byPosition(
    rawModules.filter((m) => m.deleted_at === null)
  ).map((m) => {
    const { course_lessons: rawLessons, ...module } = m;
    return {
      ...module,
      lessons: byPosition(rawLessons.filter((l) => l.deleted_at === null)).map(
        (l) => {
          const { course_questions: rawQuestions, ...lesson } = l;
          return {
            ...lesson,
            questions: byPosition(
              rawQuestions.filter((q) => q.deleted_at === null)
            ).map((q) => {
              const { course_question_options: rawOptions, ...question } = q;
              // Retired options exist only for attempt-history integrity —
              // the builder (and its publish validation) never sees them.
              return {
                ...question,
                options: byPosition(
                  rawOptions.filter((o) => o.deleted_at === null)
                ),
              };
            }),
          };
        }
      ),
    };
  });

  return {
    course,
    modules,
    publishProblems: coursePublishProblems(
      modules.map((m) => ({
        id: m.id,
        lessons: m.lessons.map<PublishLesson>((l) => ({
          id: l.id,
          kind: l.kind,
          title: l.title,
          filePath: l.file_path,
          questions: l.questions.map((q) => ({
            optionCount: q.options.length,
            correctCount: q.options.filter((o) => o.is_correct).length,
          })),
        })),
      }))
    ),
  };
}

/** Cover preview URL for the builder (private bucket → short signed URL). */
export async function signedCourseFileUrl(
  path: string,
  ttlSec = 15 * 60
): Promise<string | null> {
  const { data } = await createAdminClient()
    .storage.from(COURSE_CONTENT_BUCKET)
    .createSignedUrl(path, ttlSec);
  return data?.signedUrl ?? null;
}
