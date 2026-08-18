"use server";

import { revalidatePath } from "next/cache";
import { requireUser, type SessionUser } from "@/lib/auth";
import {
  completeContentLesson,
  submitCourseQuiz,
  type QuizFeedback,
} from "@/lib/courses";
import { mintCertificateQuietly, setCredentialName } from "@/lib/certificates";
import { courseQuizSubmitSchema, credentialNameSchema, uuid } from "@/lib/validation";

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
  revalidatePath("/cme/certificates");
  revalidatePath("/dashboard");
}

/**
 * The certificate name is collected on a learner's FIRST progress write, not
 * at signup and not at download: it is the earliest point they have committed
 * to a course, and collecting it here guarantees a name exists by the time a
 * course is finished — so a certificate is never minted without a holder.
 *
 * Returns the user with the saved name applied, since `user` was loaded before
 * this write. A failure here is silent BY DESIGN: it must never cost the
 * learner their progress, and the dialog will simply ask again.
 */
async function captureCredentialName(
  user: SessionUser,
  formData: FormData
): Promise<SessionUser> {
  if (user.profile.credential_name) return user;

  const raw = formData.get("credentialName");
  if (typeof raw !== "string" || raw.trim() === "") return user;

  const parsed = credentialNameSchema.safeParse(raw);
  if (!parsed.success) return user;
  if (!(await setCredentialName(user.id, parsed.data))) return user;

  return { ...user, profile: { ...user.profile, credential_name: parsed.data } };
}

// Both write paths mint, because either can be the action that finishes a
// course. The unique (user_id, course_id) constraint absorbs the race and the
// duplicate calls; mintCertificateQuietly swallows the rest, so a certificate
// problem never presents as a failure to save progress.

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

  const named = await captureCredentialName(user, formData);

  const result = await completeContentLesson(
    user.id,
    courseId.data,
    lessonId.data
  );
  if (result?.error) return { error: result.error };

  await mintCertificateQuietly(named, courseId.data);

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

  const named = await captureCredentialName(user, formData);

  const result = await submitCourseQuiz(
    user.id,
    courseId.data,
    parsed.data.lessonId,
    parsed.data.answers
  );
  if ("error" in result) return { error: result.error };

  // A passing attempt writes the progress row that can complete the course.
  if (result.feedback.passed) {
    await mintCertificateQuietly(named, courseId.data);
  }

  // A pass unlocks modules and completes the lesson — refresh the syllabus,
  // catalog progress and dashboard card in the same round trip.
  revalidateLearnerCourse(courseId.data);
  return { feedback: result.feedback };
}
