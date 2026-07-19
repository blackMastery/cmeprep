"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import {
  correctnessChanged,
  diffOptions,
  OptionOwnershipError,
} from "@/lib/admin/option-diff";
import { getQuestionForEdit } from "@/lib/admin/questions";
import { parseQuestionForm, questionSchema, uuid } from "@/lib/validation";
import {
  ALLOWED_IMAGE_TYPES,
  extensionForType,
  QUESTION_IMAGE_BUCKET,
} from "@/lib/storage";

export type QuestionState = {
  error?: string;
  success?: string;
  /** Zod issue path → message, keyed to match input names. */
  fieldErrors?: Record<string, string>;
} | null;

/**
 * requireAdmin() is the FIRST statement of every action, outside any
 * try/catch. The admin layout does not gate actions — the mutation runs
 * before any layout renders — and requireAdmin() signals by throwing
 * NEXT_REDIRECT, which a catch block would swallow.
 */

function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]) {
  // Built by hand rather than with flattenError, which collapses nested array
  // paths and would lose `options.2.label`.
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export async function saveQuestion(
  _prev: QuestionState,
  formData: FormData
): Promise<QuestionState> {
  const user = await requireAdmin();

  const existingId = String(formData.get("questionId") ?? "").trim();
  const isEdit = existingId.length > 0;

  const parsed = questionSchema.safeParse(parseQuestionForm(formData));
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0].message,
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
    };
  }
  const input = parsed.data;
  const admin = createAdminClient();
  const now = new Date().toISOString();

  // ── Create ────────────────────────────────────────────────
  if (!isEdit) {
    // Always insert unpublished, then flip at the end — see the publish fence
    // below. A create that dies mid-way leaves a draft, not a broken live
    // question.
    const { data: created, error } = await admin
      .from("questions")
      .insert({
        topic_id: input.topicId,
        type: input.type,
        difficulty: input.difficulty,
        stem: input.stem,
        explanation: input.explanation,
        image_path: input.imagePath,
        is_published: false,
        created_by: user.id,
        updated_at: now,
      })
      .select("id")
      .single();

    if (error || !created) return { error: "Could not create the question." };

    const { rows } = diffOptions(created.id, [], input.options);
    const { error: optError } = await admin.from("question_options").insert(rows);
    if (optError) {
      return {
        error: "The question was saved as a draft but its options failed. Re-save to retry.",
      };
    }

    if (input.isPublished) {
      await admin
        .from("questions")
        .update({ is_published: true, updated_at: now })
        .eq("id", created.id);
    }

    await audit(user.id, "question.create", created.id, {
      topicId: input.topicId,
      type: input.type,
      published: input.isPublished,
    });

    // Must come BEFORE redirect(), which throws NEXT_REDIRECT — anything
    // after it never runs, and the subject/topic counts would go stale.
    revalidatePath("/admin/questions");
    revalidatePath("/admin/subjects");

    redirect(`/admin/questions/${created.id}?created=1`);
  }

  // ── Update ────────────────────────────────────────────────
  const id = uuid().safeParse(existingId);
  if (!id.success) return { error: "Unknown question." };

  const current = await getQuestionForEdit(id.data);
  if (!current) return { error: "Unknown question." };

  let diff;
  try {
    diff = diffOptions(id.data, current.options, input.options);
  } catch (error) {
    if (error instanceof OptionOwnershipError) {
      return { error: "That option does not belong to this question." };
    }
    throw error;
  }

  const keyChanged = correctnessChanged(current.options, diff.rows);
  if (keyChanged && current.usageCount > 0) {
    const confirmed = formData.get("confirmKeyChange") === "true";
    if (!confirmed) {
      return {
        error:
          `This question has already been used in ${current.usageCount} test(s). ` +
          "Changing which option is correct will make past reviews disagree with the " +
          "scores students were given. Tick the confirmation to proceed.",
        fieldErrors: { confirmKeyChange: "Confirmation required" },
      };
    }
  }

  // Publish fence: PostgREST has no multi-statement transaction, so options
  // and the question row are separate requests. Unpublishing first means any
  // partial failure lands on a draft rather than a live question with a
  // half-written answer key.
  const needsFence = current.question.is_published;
  if (needsFence) {
    await admin
      .from("questions")
      .update({ is_published: false })
      .eq("id", id.data);
  }

  const { error: upsertError } = await admin
    .from("question_options")
    .upsert(diff.rows, { onConflict: "id" });

  if (upsertError) {
    return { error: "Could not save the options. The question is now a draft." };
  }

  if (diff.retireIds.length > 0) {
    // Retire, never delete: test_questions.option_order and
    // attempts.selected_option_ids hold these ids with no FK to protect them.
    const { error: retireError } = await admin
      .from("question_options")
      .update({ deleted_at: now })
      .in("id", diff.retireIds);

    if (retireError) {
      return { error: "Could not retire removed options. The question is now a draft." };
    }
  }

  const { error: updateError } = await admin
    .from("questions")
    .update({
      topic_id: input.topicId,
      type: input.type,
      difficulty: input.difficulty,
      stem: input.stem,
      explanation: input.explanation,
      image_path: input.imagePath,
      is_published: input.isPublished,
      updated_at: now,
    })
    .eq("id", id.data);

  if (updateError) return { error: "Could not save the question." };

  await audit(user.id, "question.update", id.data, {
    retired: diff.retireIds.length,
    optionCount: diff.rows.length,
    published: input.isPublished,
  });

  if (keyChanged) {
    await audit(user.id, "option.correctness_change", id.data, {
      before: current.options
        .filter((o) => !o.deleted_at && o.is_correct)
        .map((o) => ({ id: o.id, label: o.label })),
      after: diff.rows
        .filter((r) => r.is_correct)
        .map((r) => ({ id: r.id, label: r.label })),
      usedInTests: current.usageCount,
    });
  }

  revalidatePath("/admin/questions");
  revalidatePath(`/admin/questions/${id.data}`);
  // The topic may have changed, which moves counts between topics.
  revalidatePath("/admin/subjects");
  return { success: "Saved." };
}

export async function togglePublish(
  _prev: QuestionState,
  formData: FormData
): Promise<QuestionState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown question." };
  const publish = formData.get("publish") === "true";

  const admin = createAdminClient();

  if (publish) {
    // Refuse to publish something that would fail validation — otherwise a
    // malformed question reaches students.
    const current = await getQuestionForEdit(id.data);
    if (!current) return { error: "Unknown question." };

    const live = current.visibleOptions;
    const correct = live.filter((o) => o.is_correct).length;
    const needsMulti = current.question.type === "mcq_multi";

    if (live.length < 2) return { error: "Add at least two options before publishing." };
    if (needsMulti && correct < 2)
      return { error: "Multi-answer questions need at least two correct options." };
    if (!needsMulti && correct !== 1)
      return { error: "Mark exactly one option correct before publishing." };
    if (current.question.type === "image_based" && !current.question.image_path)
      return { error: "Image questions need an image before publishing." };
  }

  const { error } = await admin
    .from("questions")
    .update({ is_published: publish, updated_at: new Date().toISOString() })
    .eq("id", id.data);

  if (error) return { error: "Could not change the publish state." };

  await audit(user.id, publish ? "question.publish" : "question.unpublish", id.data);
  revalidatePath("/admin/questions");
  revalidatePath(`/admin/questions/${id.data}`);
  return { success: publish ? "Published." : "Moved to drafts." };
}

export async function setQuestionDeleted(
  _prev: QuestionState,
  formData: FormData
): Promise<QuestionState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown question." };
  const restore = formData.get("restore") === "true";

  const admin = createAdminClient();
  const { error } = await admin
    .from("questions")
    .update({
      // Soft delete only — historical papers still resolve this question.
      deleted_at: restore ? null : new Date().toISOString(),
      is_published: restore ? false : false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id.data);

  if (error) return { error: "Could not update the question." };

  await audit(user.id, restore ? "question.restore" : "question.delete", id.data);
  revalidatePath("/admin/questions");
  // Subject/topic counts are derived from questions, so they go stale too.
  revalidatePath("/admin/subjects");
  return { success: restore ? "Restored as a draft." : "Question deleted." };
}

/**
 * Mint a one-time signed upload URL so the browser sends image bytes straight
 * to Storage. Keeps files away from the Server Action 1MB body cap, the proxy
 * body buffer, and serverless request limits.
 */
export async function createImageUploadUrl(
  contentType: string
): Promise<
  { ok: true; path: string; token: string } | { ok: false; error: string }
> {
  await requireAdmin();

  // Server-side allowlist is the real check; the client one is only UX.
  if (!ALLOWED_IMAGE_TYPES.includes(contentType as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return { ok: false, error: "Only PNG, JPEG or WebP images are allowed." };
  }
  const ext = extensionForType(contentType);
  if (!ext) return { ok: false, error: "Unsupported image type." };

  // Flat path: a brand-new question has no id yet, so keying by question id
  // would require an orphan-move step on first save.
  const path = `q/${crypto.randomUUID()}.${ext}`;

  const { data, error } = await createAdminClient()
    .storage.from(QUESTION_IMAGE_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) return { ok: false, error: "Could not start the upload." };
  return { ok: true, path: data.path, token: data.token };
}
