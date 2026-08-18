"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  completeContentLesson,
  submitCourseQuiz,
  type QuizFeedback,
} from "@/lib/courses";
import { courseQuizSubmitSchema, uuid } from "@/lib/validation";

/**
 * Learner actions. requireUser() first, outside any try/catch — the (app)
 * layout does not protect Server Actions. The unlock rule is re-checked in
 * lib/courses.ts on every call; the UI's disabled states are cosmetic.
 */

export type LessonActionState = { error?: string } | null;

function revalidateLearnerCourse(courseId: string) {
  revalidatePath("/cme");
  revalidatePath(`/cme/${courseId}`);
  // "page" type takes the ROUTE PATTERN — a half-interpolated string like
  // `/cme/${id}/lessons/[lessonId]` matches nothing.
  revalidatePath("/cme/[id]/lessons/[lessonId]", "page");
  revalidatePath("/dashboard");
}

export async function markLessonComplete(
  _prev: LessonActionState,
  formData: FormData
): Promise<LessonActionState> {
  const user = await requireUser();

  const courseId = uuid().safeParse(formData.get("courseId"));
  const lessonId = uuid().safeParse(formData.get("lessonId"));
  if (!courseId.success || !lessonId.success) {
    return { error: "That lesson no longer exists." };
  }

  const result = await completeContentLesson(
    user.id,
    courseId.data,
    lessonId.data
  );
  if (result?.error) return { error: result.error };

  revalidateLearnerCourse(courseId.data);
  return null;
}

export type QuizSubmitState =
  | { error: string }
  | { feedback: QuizFeedback }
  | null;

export async function submitQuiz(
  _prev: QuizSubmitState,
  formData: FormData
): Promise<QuizSubmitState> {
  const user = await requireUser();

  const courseId = uuid().safeParse(formData.get("courseId"));
  if (!courseId.success) return { error: "That quiz no longer exists." };

  let answers: unknown = [];
  try {
    answers = JSON.parse(String(formData.get("answers") ?? "[]"));
  } catch {
    answers = [];
  }
  const parsed = courseQuizSubmitSchema.safeParse({
    lessonId: formData.get("lessonId"),
    answers,
  });
  if (!parsed.success) return { error: "Answer the quiz before submitting." };

  const result = await submitCourseQuiz(
    user.id,
    courseId.data,
    parsed.data.lessonId,
    parsed.data.answers
  );
  if ("error" in result) return { error: result.error };

  // A pass unlocks modules and completes the lesson — refresh the syllabus,
  // catalog progress and dashboard card in the same round trip.
  revalidateLearnerCourse(courseId.data);
  return { feedback: result.feedback };
}
