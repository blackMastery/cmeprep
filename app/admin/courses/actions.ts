"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { getCourseBuilder } from "@/lib/admin/courses";
import { diffOptions, OptionOwnershipError } from "@/lib/admin/option-diff";
import { nextPosition } from "@/lib/admin/taxonomy";
import {
  courseUploadProblem,
  DEFAULT_PASS_PCT,
  fileKindOf,
  reorderSiblings,
} from "@/lib/courses-core";
import {
  COURSE_CONTENT_BUCKET,
  courseExtensionForType,
  isCourseObjectPath,
} from "@/lib/storage";
import {
  courseLessonSchema,
  courseMetaSchema,
  courseModuleTitleSchema,
  courseQuestionSchema,
  uuid,
} from "@/lib/validation";
import type { CourseLessonKind } from "@/lib/supabase/types";
import type { AdminState } from "@/app/admin/subjects/actions";

/**
 * Every action calls requireAdmin() as its FIRST statement, outside any
 * try/catch — the admin layout does not protect Server Actions.
 *
 * Published courses are edited in place (spec §6): every mutation here lands
 * on learners immediately, so each one revalidates the learner surfaces too.
 */

function revalidateCourses() {
  revalidatePath("/admin/courses");
  revalidatePath("/admin/courses/[id]", "page");
  revalidatePath("/courses");
  revalidatePath("/courses/[id]", "page");
  revalidatePath("/courses/[id]/lessons/[lessonId]", "page");
  revalidatePath("/dashboard");
}

/** The module's course id, or null — actions verify parentage before writes. */
async function courseOfModule(moduleId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("course_modules")
    .select("course_id")
    .eq("id", moduleId)
    .is("deleted_at", null)
    .maybeSingle();
  return data?.course_id ?? null;
}

// ── course lifecycle ────────────────────────────────────────

export async function createCourse(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const parsed = courseMetaSchema.safeParse({
    title: formData.get("title"),
    description: "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { data, error } = await createAdminClient()
    .from("courses")
    .insert({ title: parsed.data.title, created_by: user.id })
    .select("id")
    .single();
  if (error || !data) return { error: "Could not create the course." };

  await audit(user.id, "course.create", data.id, { title: parsed.data.title });
  revalidateCourses();
  redirect(`/admin/courses/${data.id}`);
}

export async function updateCourseMeta(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown course." };

  const parsed = courseMetaSchema.safeParse({
    title: formData.get("title"),
    description: String(formData.get("description") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // "" = remove the cover. A non-empty path must be one WE minted for THIS
  // course — it is client-supplied and read by the service-role client.
  const rawCover = String(formData.get("coverPath") ?? "").trim();
  const coverPath = rawCover === "" ? null : rawCover;
  if (
    coverPath !== null &&
    !(isCourseObjectPath(coverPath) && coverPath.startsWith(`courses/${id.data}/cover/`))
  ) {
    return { error: "That cover upload doesn't belong to this course." };
  }

  const { error } = await createAdminClient()
    .from("courses")
    .update({
      title: parsed.data.title,
      description: parsed.data.description,
      cover_path: coverPath,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id.data);
  if (error) return { error: "Could not save the course." };

  await audit(user.id, "course.update", id.data, { title: parsed.data.title });
  revalidateCourses();
  return { success: "Course saved." };
}

export async function setCourseStatus(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  const publish = formData.get("status") === "published";
  if (!id.success) return { error: "Unknown course." };

  if (publish) {
    // The publish gate (spec §6). Recomputed server-side — the builder's
    // disabled button is advisory only.
    const builder = await getCourseBuilder(id.data);
    if (!builder) return { error: "Unknown course." };
    if (builder.publishProblems.length > 0) {
      return { error: `Not ready to publish: ${builder.publishProblems[0]}` };
    }
  }

  const { error } = await createAdminClient()
    .from("courses")
    .update({
      status: publish ? "published" : "draft",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id.data);
  if (error) return { error: "Could not change the course status." };

  await audit(user.id, publish ? "course.publish" : "course.unpublish", id.data);
  revalidateCourses();
  return { success: publish ? "Course published." : "Course unpublished." };
}

export async function deleteCourse(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown course." };

  const { error } = await createAdminClient()
    .from("courses")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id.data);
  if (error) return { error: "Could not delete the course." };

  await audit(user.id, "course.delete", id.data);
  revalidateCourses();
  return { success: "Course deleted. Restore it from the deleted filter." };
}

export async function restoreCourse(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown course." };

  const { error } = await createAdminClient()
    .from("courses")
    .update({ deleted_at: null })
    .eq("id", id.data);
  if (error) return { error: "Could not restore the course." };

  await audit(user.id, "course.restore", id.data);
  revalidateCourses();
  return { success: "Course restored." };
}

// ── modules ─────────────────────────────────────────────────

export async function addModule(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const courseId = uuid().safeParse(formData.get("courseId"));
  const title = courseModuleTitleSchema.safeParse(formData.get("title"));
  if (!courseId.success) return { error: "Unknown course." };
  if (!title.success) return { error: title.error.issues[0].message };

  const admin = createAdminClient();
  const { data: siblings } = await admin
    .from("course_modules")
    .select("position")
    .eq("course_id", courseId.data)
    .is("deleted_at", null);

  const { data, error } = await admin
    .from("course_modules")
    .insert({
      course_id: courseId.data,
      title: title.data,
      position: nextPosition(siblings ?? []),
    })
    .select("id")
    .single();
  if (error || !data) return { error: "Could not add the module." };

  await audit(user.id, "course.module_save", data.id, {
    courseId: courseId.data,
    title: title.data,
  });
  revalidateCourses();
  return { success: "Module added." };
}

export async function renameModule(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  const title = courseModuleTitleSchema.safeParse(formData.get("title"));
  if (!id.success) return { error: "Unknown module." };
  if (!title.success) return { error: title.error.issues[0].message };

  const { error } = await createAdminClient()
    .from("course_modules")
    .update({ title: title.data, updated_at: new Date().toISOString() })
    .eq("id", id.data);
  if (error) return { error: "Could not rename the module." };

  await audit(user.id, "course.module_save", id.data, { title: title.data });
  revalidateCourses();
  return { success: "Module renamed." };
}

export async function deleteModule(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown module." };

  // Soft delete; lessons inside become invisible with it (visibility checks
  // the whole parent chain). Learner progress rows stay put and completion
  // math simply stops counting them (spec §6).
  const { error } = await createAdminClient()
    .from("course_modules")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id.data);
  if (error) return { error: "Could not delete the module." };

  await audit(user.id, "course.module_delete", id.data);
  revalidateCourses();
  return { success: "Module deleted." };
}

export async function reorderModule(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  const direction = formData.get("direction") === "up" ? "up" : "down";
  if (!id.success) return { error: "Unknown module." };

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("course_modules")
    .select("course_id")
    .eq("id", id.data)
    .maybeSingle();
  if (!target) return { error: "Unknown module." };

  const { data: siblings } = await admin
    .from("course_modules")
    .select("id, position")
    .eq("course_id", target.course_id)
    .is("deleted_at", null);

  const renumbered = reorderSiblings(siblings ?? [], id.data, direction);
  if (!renumbered) return { success: "Already at the end." };
  const { error } = await applyPositions(admin, "course_modules", renumbered);
  if (error) return { error: "Could not reorder." };

  await audit(user.id, "course.module_reorder", id.data, { direction });
  revalidateCourses();
  return { success: "Reordered." };
}

// ── lessons ─────────────────────────────────────────────────

const LESSON_KINDS: readonly CourseLessonKind[] = [
  "video",
  "image",
  "text",
  "pdf",
  "quiz",
];

export async function addLesson(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const moduleId = uuid().safeParse(formData.get("moduleId"));
  const title = courseModuleTitleSchema.safeParse(formData.get("title"));
  const kind = String(formData.get("kind") ?? "") as CourseLessonKind;
  if (!moduleId.success) return { error: "Unknown module." };
  if (!title.success) return { error: title.error.issues[0].message };
  if (!LESSON_KINDS.includes(kind)) return { error: "Pick a lesson type." };

  if (!(await courseOfModule(moduleId.data))) return { error: "Unknown module." };

  const admin = createAdminClient();
  const { data: siblings } = await admin
    .from("course_lessons")
    .select("position")
    .eq("module_id", moduleId.data)
    .is("deleted_at", null);

  const { data, error } = await admin
    .from("course_lessons")
    .insert({
      module_id: moduleId.data,
      title: title.data,
      kind,
      position: nextPosition(siblings ?? []),
      // Quiz lessons start at the default threshold (CHECK: quiz-only column).
      pass_pct: kind === "quiz" ? DEFAULT_PASS_PCT : null,
    })
    .select("id")
    .single();
  if (error || !data) return { error: "Could not add the lesson." };

  await audit(user.id, "course.lesson_save", data.id, {
    moduleId: moduleId.data,
    kind,
    title: title.data,
  });
  revalidateCourses();
  return { success: "Lesson added." };
}

export async function updateLesson(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown lesson." };

  // "" → null BEFORE zod — coerce would turn it into 0 (plan-form precedent).
  const rawPassPct = String(formData.get("passPct") ?? "").trim();
  const rawFileSize = String(formData.get("fileSize") ?? "").trim();
  const rawFilePath = String(formData.get("filePath") ?? "").trim();

  const parsed = courseLessonSchema.safeParse({
    title: formData.get("title"),
    kind: formData.get("kind"),
    bodyMd: String(formData.get("bodyMd") ?? ""),
    passPct: rawPassPct === "" ? null : rawPassPct,
    filePath: rawFilePath === "" ? null : rawFilePath,
    fileSize: rawFileSize === "" ? null : rawFileSize,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const admin = createAdminClient();
  const { data: lesson } = await admin
    .from("course_lessons")
    .select("id, kind, module_id, file_path")
    .eq("id", id.data)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lesson) return { error: "Unknown lesson." };

  // Kind is immutable after creation — it defines the lesson's shape (file
  // vs text vs quiz) and what learner progress meant. Recreate instead.
  if (parsed.data.kind !== lesson.kind) {
    return { error: "A lesson's type can't change — add a new lesson instead." };
  }

  const fileKind = fileKindOf(lesson.kind);
  let filePath = parsed.data.filePath;
  if (fileKind === null) {
    filePath = null; // CHECK constraint would reject it anyway
  } else if (filePath !== null && filePath !== lesson.file_path) {
    // Client-supplied path: accept only objects minted for THIS lesson.
    if (
      !isCourseObjectPath(filePath) ||
      !filePath.includes(`/lessons/${lesson.id}/`)
    ) {
      return { error: "That upload doesn't belong to this lesson." };
    }
  }

  const { error } = await admin
    .from("course_lessons")
    .update({
      title: parsed.data.title,
      body_md: parsed.data.bodyMd === "" ? null : parsed.data.bodyMd,
      pass_pct:
        lesson.kind === "quiz" ? (parsed.data.passPct ?? DEFAULT_PASS_PCT) : null,
      file_path: filePath,
      file_size: filePath === null ? null : parsed.data.fileSize,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id.data);
  if (error) return { error: "Could not save the lesson." };

  await audit(user.id, "course.lesson_save", id.data, {
    title: parsed.data.title,
  });
  revalidateCourses();
  return { success: "Lesson saved." };
}

export async function deleteLesson(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown lesson." };

  const { error } = await createAdminClient()
    .from("course_lessons")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id.data);
  if (error) return { error: "Could not delete the lesson." };

  await audit(user.id, "course.lesson_delete", id.data);
  revalidateCourses();
  return { success: "Lesson deleted." };
}

export async function reorderLesson(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  const direction = formData.get("direction") === "up" ? "up" : "down";
  if (!id.success) return { error: "Unknown lesson." };

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("course_lessons")
    .select("module_id")
    .eq("id", id.data)
    .maybeSingle();
  if (!target) return { error: "Unknown lesson." };

  const { data: siblings } = await admin
    .from("course_lessons")
    .select("id, position")
    .eq("module_id", target.module_id)
    .is("deleted_at", null);

  const renumbered = reorderSiblings(siblings ?? [], id.data, direction);
  if (!renumbered) return { success: "Already at the end." };
  const { error } = await applyPositions(admin, "course_lessons", renumbered);
  if (error) return { error: "Could not reorder." };

  await audit(user.id, "course.lesson_reorder", id.data, { direction });
  revalidateCourses();
  return { success: "Reordered." };
}

// ── quiz questions ──────────────────────────────────────────

export async function saveQuestion(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const lessonId = uuid().safeParse(formData.get("lessonId"));
  if (!lessonId.success) return { error: "Unknown quiz." };
  const rawQuestionId = String(formData.get("questionId") ?? "").trim();
  const questionId =
    rawQuestionId === "" ? null : uuid().safeParse(rawQuestionId).data ?? null;

  let options: unknown = [];
  try {
    options = JSON.parse(String(formData.get("options") ?? "[]"));
  } catch {
    options = [];
  }

  const parsed = courseQuestionSchema.safeParse({
    promptMd: formData.get("promptMd"),
    explanationMd: String(formData.get("explanationMd") ?? ""),
    options,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const admin = createAdminClient();
  const { data: lesson } = await admin
    .from("course_lessons")
    .select("id, kind")
    .eq("id", lessonId.data)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lesson || lesson.kind !== "quiz") return { error: "Unknown quiz." };

  let savedQuestionId = questionId;
  if (questionId === null) {
    const { data: siblings } = await admin
      .from("course_questions")
      .select("position")
      .eq("lesson_id", lessonId.data)
      .is("deleted_at", null);
    const { data, error } = await admin
      .from("course_questions")
      .insert({
        lesson_id: lessonId.data,
        prompt_md: parsed.data.promptMd,
        explanation_md: parsed.data.explanationMd,
        position: nextPosition(siblings ?? []),
      })
      .select("id")
      .single();
    if (error || !data) return { error: "Could not save the question." };
    savedQuestionId = data.id;
  } else {
    // Confirm the question still exists AND belongs to this quiz BEFORE any
    // write: a 0-row update returns no error, and the option writes below
    // are scoped only by question_id — a stale/foreign id must stop here,
    // not silently rewrite another quiz's options.
    const { data: owned } = await admin
      .from("course_questions")
      .select("id")
      .eq("id", questionId)
      .eq("lesson_id", lessonId.data)
      .is("deleted_at", null)
      .maybeSingle();
    if (!owned) {
      return { error: "That question no longer exists — reload the builder." };
    }
    const { error } = await admin
      .from("course_questions")
      .update({
        prompt_md: parsed.data.promptMd,
        explanation_md: parsed.data.explanationMd,
        updated_at: new Date().toISOString(),
      })
      .eq("id", questionId);
    if (error) return { error: "Could not save the question." };
  }

  // Options go through diffOptions (the exam editor's pure, tested helper):
  // one upsert for updates+inserts, retire-never-delete for removals (quiz
  // attempts snapshot option ids in jsonb, so history must keep resolving),
  // and forged option ids are rejected instead of silently no-oping.
  const { data: existing } = await admin
    .from("course_question_options")
    .select("id, label, is_correct, position, deleted_at")
    .eq("question_id", savedQuestionId as string);

  let diff;
  try {
    diff = diffOptions(
      savedQuestionId as string,
      existing ?? [],
      parsed.data.options
    );
  } catch (e) {
    if (e instanceof OptionOwnershipError) {
      return { error: "Those options don't belong to this question — reload the builder." };
    }
    throw e;
  }

  const { error: upsertError } = await admin
    .from("course_question_options")
    .upsert(diff.rows, { onConflict: "id" });
  if (upsertError) return { error: "Could not save the options." };

  if (diff.retireIds.length > 0) {
    const { error: retireError } = await admin
      .from("course_question_options")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", diff.retireIds);
    if (retireError) return { error: "Could not save the options." };
  }

  await audit(user.id, "course.question_save", savedQuestionId, {
    lessonId: lessonId.data,
    options: parsed.data.options.length,
  });
  revalidateCourses();
  return { success: "Question saved." };
}

export async function deleteQuestion(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown question." };

  const { error } = await createAdminClient()
    .from("course_questions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id.data);
  if (error) return { error: "Could not delete the question." };

  await audit(user.id, "course.question_delete", id.data);
  revalidateCourses();
  return { success: "Question deleted." };
}

// ── uploads ─────────────────────────────────────────────────

type UploadTarget =
  | { kind: "cover"; courseId: string }
  | { kind: "lesson"; courseId: string; lessonId: string };

/**
 * Mint a one-time signed upload URL (browser → Storage, bytes never pass
 * through Next — the image-upload.tsx trick, sized up for video). Validates
 * mime + size against the per-kind caps BEFORE signing; the bucket's own
 * config is the second layer.
 */
export async function createCourseUploadUrl(
  target: UploadTarget,
  contentType: string,
  sizeBytes: number
): Promise<
  { ok: true; path: string; token: string } | { ok: false; error: string }
> {
  await requireAdmin();

  const courseId = uuid().safeParse(target.courseId);
  if (!courseId.success) return { ok: false, error: "Unknown course." };

  const admin = createAdminClient();
  let fileKind;
  let prefix: string;

  if (target.kind === "cover") {
    fileKind = "image" as const;
    prefix = `courses/${courseId.data}/cover`;
    // Same pure validator as lesson files — it also rejects NaN/zero sizes,
    // which a hand-rolled `sizeBytes > max` check silently passes.
    const problem = courseUploadProblem("image", contentType, sizeBytes);
    if (problem) return { ok: false, error: problem };
  } else {
    const lessonId = uuid().safeParse(target.lessonId);
    if (!lessonId.success) return { ok: false, error: "Unknown lesson." };
    const { data: lesson } = await admin
      .from("course_lessons")
      .select("id, kind, course_modules!inner(course_id)")
      .eq("id", lessonId.data)
      .is("deleted_at", null)
      .maybeSingle();
    const lessonCourse = (
      lesson as { course_modules: { course_id: string } } | null
    )?.course_modules.course_id;
    if (!lesson || lessonCourse !== courseId.data) {
      return { ok: false, error: "Unknown lesson." };
    }
    fileKind = fileKindOf(lesson.kind);
    if (!fileKind) return { ok: false, error: "This lesson type has no file." };
    const problem = courseUploadProblem(fileKind, contentType, sizeBytes);
    if (problem) return { ok: false, error: problem };
    prefix = `courses/${courseId.data}/lessons/${lessonId.data}`;
  }

  const ext = courseExtensionForType(contentType);
  if (!ext) return { ok: false, error: "Unsupported file type." };

  const path = `${prefix}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await admin.storage
    .from(COURSE_CONTENT_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "Could not start the upload." };
  return { ok: true, path: data.path, token: data.token };
}

// ── reorder plumbing ────────────────────────────────────────

/** Write the full renumbered list computed by reorderSiblings (courses-core)
 * — the whole list, not a two-row swap, so gapped positions can never tie. */
async function applyPositions(
  admin: ReturnType<typeof createAdminClient>,
  table: "course_modules" | "course_lessons",
  rows: { id: string; position: number }[]
): Promise<{ error: unknown }> {
  const results = await Promise.all(
    rows.map((row) =>
      admin.from(table).update({ position: row.position }).eq("id", row.id)
    )
  );
  return { error: results.find((r) => r.error)?.error ?? null };
}
