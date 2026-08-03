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
import { publishBlocker } from "@/lib/admin/publish-gate";
import {
  bulkQuestionIdsSchema,
  parseQuestionForm,
  questionSchema,
  uuid,
} from "@/lib/validation";
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
 * Result of a bulk action on the questions list.
 *
 * Separate from QuestionState because a batch can half-succeed: bulk publish
 * takes the questions it can and reports the rest rather than refusing the
 * whole selection, which would make one broken answer key block nineteen good
 * questions.
 */
export type BulkState = {
  error?: string;
  success?: string;
  /** Publish only: what was left behind, and why. */
  skipped?: { id: string; stem: string; reason: string }[];
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
        subject_id: input.subjectId,
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
      subjectId: input.subjectId,
      type: input.type,
      published: input.isPublished,
    });

    // Must come BEFORE redirect(), which throws NEXT_REDIRECT — anything
    // after it never runs, and the subject counts would go stale.
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
      subject_id: input.subjectId,
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
  // The subject may have changed, which moves counts between subjects.
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
    const blocker = publishBlocker({
      type: current.question.type,
      image_path: current.question.image_path,
      optionCount: live.length,
      correctCount: live.filter((o) => o.is_correct).length,
    });
    if (blocker) return { error: blocker };
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
  // Subject counts are derived from questions, so they go stale too.
  revalidatePath("/admin/subjects");
  return { success: restore ? "Restored as a draft." : "Question deleted." };
}

/* ── Bulk actions ───────────────────────────────────────────
 *
 * One action per click that loops server-side, rather than dispatching the
 * single-row action N times: Next dispatches Server Actions one at a time per
 * client, so twenty round-trips would run strictly in series, and twenty audit
 * rows would say nothing that one summary row doesn't.
 */

function bulkIds(formData: FormData) {
  return bulkQuestionIdsSchema.safeParse(formData.getAll("ids").map(String));
}

export async function bulkSetPublished(
  _prev: BulkState,
  formData: FormData
): Promise<BulkState> {
  const user = await requireAdmin();

  const parsed = bulkIds(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const ids = parsed.data;
  const publish = formData.get("publish") === "true";
  const now = new Date().toISOString();

  const admin = createAdminClient();

  if (!publish) {
    const { data, error } = await admin
      .from("questions")
      .update({ is_published: false, updated_at: now })
      .in("id", ids)
      // A deleted question is already out of circulation; leave its row alone
      // so the reported count means what it says.
      .is("deleted_at", null)
      .select("id");

    if (error) return { error: "Could not change the publish state." };
    const affected = data?.length ?? 0;
    if (affected === 0) return { error: "Nothing to unpublish." };

    await audit(user.id, "question.bulk_unpublish", null, {
      ids: data?.map((r) => r.id) ?? [],
      count: affected,
    });
    revalidateQuestions();
    return { success: `${affected} moved to drafts.` };
  }

  // Two reads for the whole batch instead of getQuestionForEdit per id, which
  // would be two round-trips each. Deleted questions are excluded here rather
  // than reported — a deleted row is not a fixable publish failure.
  const [{ data: questions }, { data: options }] = await Promise.all([
    admin
      .from("questions")
      .select("id, stem, type, image_path")
      .in("id", ids)
      .is("deleted_at", null),
    admin
      .from("question_options")
      .select("question_id, is_correct")
      .is("deleted_at", null)
      .in("question_id", ids),
  ]);

  const optionCount = new Map<string, number>();
  const correctCount = new Map<string, number>();
  for (const o of options ?? []) {
    optionCount.set(o.question_id, (optionCount.get(o.question_id) ?? 0) + 1);
    if (o.is_correct) {
      correctCount.set(o.question_id, (correctCount.get(o.question_id) ?? 0) + 1);
    }
  }

  const publishable: string[] = [];
  const skipped: { id: string; stem: string; reason: string }[] = [];

  for (const q of questions ?? []) {
    const reason = publishBlocker({
      type: q.type,
      image_path: q.image_path,
      optionCount: optionCount.get(q.id) ?? 0,
      correctCount: correctCount.get(q.id) ?? 0,
    });
    if (reason) skipped.push({ id: q.id, stem: q.stem, reason });
    else publishable.push(q.id);
  }

  if (publishable.length === 0) {
    return {
      error:
        skipped.length > 0
          ? "Nothing could be published — every question selected has a problem."
          : "Nothing to publish.",
      skipped,
    };
  }

  const { error } = await admin
    .from("questions")
    .update({ is_published: true, updated_at: now })
    .in("id", publishable);

  if (error) return { error: "Could not change the publish state." };

  await audit(user.id, "question.bulk_publish", null, {
    ids: publishable,
    count: publishable.length,
    skipped: skipped.length,
  });
  revalidateQuestions();

  // "published", not "changed": some of these were already live, and claiming
  // otherwise would misreport what happened.
  return {
    success:
      skipped.length > 0
        ? `${publishable.length} published, ${skipped.length} skipped.`
        : `${publishable.length} published.`,
    skipped,
  };
}

export async function bulkSetDeleted(
  _prev: BulkState,
  formData: FormData
): Promise<BulkState> {
  const user = await requireAdmin();

  const parsed = bulkIds(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const ids = parsed.data;
  const restore = formData.get("restore") === "true";
  const now = new Date().toISOString();

  const update = createAdminClient()
    .from("questions")
    .update({
      // Soft delete only — historical papers still resolve these questions.
      deleted_at: restore ? null : now,
      // Restore lands in Draft, never straight back to live.
      is_published: false,
      updated_at: now,
    })
    .in("id", ids);

  // Scope to rows the action can actually move. Without this, Restore would
  // reach every selected question and quietly unpublish the live ones, since
  // it writes is_published: false unconditionally.
  const { data, error } = restore
    ? await update.not("deleted_at", "is", null).select("id")
    : await update.is("deleted_at", null).select("id");

  if (error) return { error: "Could not update the questions." };

  const affected = data?.length ?? 0;
  if (affected === 0) {
    return { error: restore ? "Nothing to restore." : "Nothing to delete." };
  }

  await audit(user.id, restore ? "question.bulk_restore" : "question.bulk_delete", null, {
    ids: data?.map((r) => r.id) ?? [],
    count: affected,
  });
  revalidateQuestions();

  return {
    success: restore
      ? `${affected} restored as draft${affected === 1 ? "" : "s"}.`
      : `${affected} question${affected === 1 ? "" : "s"} deleted.`,
  };
}

function revalidateQuestions() {
  revalidatePath("/admin/questions");
  // The dynamic-route form invalidates every question's detail page at once —
  // a bulk action can touch twenty of them.
  revalidatePath("/admin/questions/[id]", "page");
  // Subject counts are derived from questions, so they go stale too.
  revalidatePath("/admin/subjects");
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
