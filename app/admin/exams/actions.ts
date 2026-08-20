"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { nextPosition } from "@/lib/admin/taxonomy";
import {
  examDocumentEditSchema,
  examDocumentSchema,
  examSchema,
  specialtySchema,
  uuid,
} from "@/lib/validation";
import { examDocumentUploadProblem } from "@/lib/exam-documents-core";
import {
  EXAM_DOCUMENT_BUCKET,
  examDocumentExtensionForType,
  examDocumentPathExamId,
  isExamDocumentPath,
} from "@/lib/storage";
import type { AdminState } from "@/app/admin/subjects/actions";

const UNIQUE_VIOLATION = "23505";
const FK_VIOLATION = "23503";

function revalidateTaxonomy() {
  revalidatePath("/admin/exams");
  // "page" scope so every /admin/exams/[id] instance is invalidated, not just
  // the literal path — a rename has to land on the detail page it came from.
  revalidatePath("/admin/exams/[id]", "page");
  revalidatePath("/admin/subjects");
}

/**
 * Every action calls requireAdmin() as its FIRST statement, outside any
 * try/catch — the admin layout does not protect Server Actions, and
 * requireAdmin() throws NEXT_REDIRECT which a catch would swallow.
 */

export async function createExam(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const parsed = examSchema.safeParse({
    name: formData.get("name"),
    code: String(formData.get("code") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const admin = createAdminClient();
  const { data: existing } = await admin.from("exams").select("position");

  const { data, error } = await admin
    .from("exams")
    .insert({
      name: parsed.data.name,
      code: parsed.data.code ?? null,
      position: nextPosition(existing ?? []),
    })
    .select("id")
    .single();

  if (error) {
    return {
      error:
        error.code === UNIQUE_VIOLATION
          ? "An exam with that name already exists."
          : "Could not create the exam.",
    };
  }

  await audit(user.id, "exam.create", data.id, { name: parsed.data.name });
  revalidateTaxonomy();
  return { success: `Created ${parsed.data.name}.` };
}

export async function renameExam(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  const parsed = examSchema.safeParse({
    name: formData.get("name"),
    code: String(formData.get("code") ?? "").trim() || undefined,
  });
  if (!id.success) return { error: "Unknown exam." };
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("exams")
    .select("name")
    .eq("id", id.data)
    .maybeSingle();

  const { error } = await admin
    .from("exams")
    .update({ name: parsed.data.name, code: parsed.data.code ?? null })
    .eq("id", id.data);

  if (error) {
    return {
      error:
        error.code === UNIQUE_VIOLATION
          ? "An exam with that name already exists."
          : "Could not rename the exam.",
    };
  }

  await audit(user.id, "exam.rename", id.data, {
    before: before?.name,
    after: parsed.data.name,
  });
  revalidateTaxonomy();
  return { success: "Saved." };
}

/**
 * Offer an exam at checkout, or withdraw it.
 *
 * Withdrawing is not a revocation — every live subscription to the exam keeps
 * working to its period end, and the exam stays in the practice wizard for
 * those buyers. It only stops NEW purchases, which is what lets a bank be
 * built up before anyone can pay for it.
 */
export async function setExamAvailability(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown exam." };
  const isActive = formData.get("isActive") === "true";

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("exams")
    .select("name, is_active")
    .eq("id", id.data)
    .maybeSingle();

  if (!before) return { error: "Unknown exam." };
  if (before.is_active === isActive) return { success: "No change." };

  const { error } = await admin
    .from("exams")
    .update({ is_active: isActive })
    .eq("id", id.data);

  if (error) return { error: "Could not update availability." };

  await audit(user.id, "exam.availability", id.data, {
    before: before.is_active,
    after: isActive,
  });
  revalidateTaxonomy();
  // The buyer-facing surfaces read this flag, so they must not serve a stale
  // picker: /checkout is dynamic per plan, hence the "page" scope.
  revalidatePath("/checkout/[planId]", "page");
  revalidatePath("/tests/new");

  return {
    success: isActive
      ? `${before.name} is now offered at checkout.`
      : `${before.name} is no longer offered at checkout.`,
  };
}

export async function deleteExam(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown exam." };

  const admin = createAdminClient();

  // Pre-flight in code even though the FK would cascade — cascading an exam
  // delete through specialties into subjects would be a data catastrophe, so
  // the UI never lets it fire.
  const { count: specialtyCount } = await admin
    .from("specialties")
    .select("id", { count: "exact", head: true })
    .eq("exam_id", id.data);

  if ((specialtyCount ?? 0) > 0) {
    return {
      error: `That exam still has ${specialtyCount} specialt${specialtyCount === 1 ? "y" : "ies"}. Delete or move them first.`,
    };
  }

  // subscriptions.exam_id is ON DELETE RESTRICT on purpose — deleting an exam
  // that was sold would either wipe purchase history or (with SET NULL) promote
  // every buyer to all-access. Block with a clear reason instead.
  const { count: subscriptionCount } = await admin
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("exam_id", id.data);

  if ((subscriptionCount ?? 0) > 0) {
    return {
      error: `That exam still has ${subscriptionCount} subscription${subscriptionCount === 1 ? "" : "s"} tied to it. Withdraw it from checkout instead — sold exams can't be deleted.`,
    };
  }

  // exam_documents.exam_id cascades, so without this the rows would vanish
  // with no audit entry naming them AND their objects would stay in the bucket
  // forever — deleteExamDocument is the only thing that removes bytes. Same
  // stance as the specialty pre-flight: don't let a cascade fire silently.
  const { count: documentCount } = await admin
    .from("exam_documents")
    .select("id", { count: "exact", head: true })
    .eq("exam_id", id.data)
    .is("deleted_at", null);

  if ((documentCount ?? 0) > 0) {
    return {
      error: `That exam still has ${documentCount} document${documentCount === 1 ? "" : "s"}. Delete them first, so their files are removed from storage too.`,
    };
  }

  const { error } = await admin.from("exams").delete().eq("id", id.data);
  if (error) {
    return {
      error:
        error.code === FK_VIOLATION
          ? "That exam still has subscriptions or other records tied to it, so it can't be deleted."
          : "Could not delete the exam.",
    };
  }

  await audit(user.id, "exam.delete", id.data);
  revalidateTaxonomy();

  // Delete is only offered from /admin/exams/[id], which 404s the moment the
  // row is gone. Leave for the list instead of re-rendering a dead page.
  redirect("/admin/exams");
}

export async function createSpecialty(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const parsed = specialtySchema.safeParse({
    examId: formData.get("examId"),
    name: formData.get("name"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const admin = createAdminClient();
  const { data: siblings } = await admin
    .from("specialties")
    .select("position")
    .eq("exam_id", parsed.data.examId);

  const { data, error } = await admin
    .from("specialties")
    .insert({
      exam_id: parsed.data.examId,
      name: parsed.data.name,
      position: nextPosition(siblings ?? []),
    })
    .select("id")
    .single();

  if (error) {
    return {
      error:
        error.code === UNIQUE_VIOLATION
          ? "That exam already has a specialty with this name."
          : "Could not create the specialty.",
    };
  }

  await audit(user.id, "specialty.create", data.id, {
    name: parsed.data.name,
    examId: parsed.data.examId,
  });
  revalidateTaxonomy();
  return { success: `Created ${parsed.data.name}.` };
}

export async function renameSpecialty(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  if (!id.success) return { error: "Unknown specialty." };
  if (name.length < 2) return { error: "Specialty name is too short" };

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("specialties")
    .select("name")
    .eq("id", id.data)
    .maybeSingle();

  const { error } = await admin
    .from("specialties")
    .update({ name })
    .eq("id", id.data);

  if (error) {
    return {
      error:
        error.code === UNIQUE_VIOLATION
          ? "That exam already has a specialty with this name."
          : "Could not rename the specialty.",
    };
  }

  await audit(user.id, "specialty.rename", id.data, {
    before: before?.name,
    after: name,
  });
  revalidateTaxonomy();
  return { success: "Renamed." };
}

export async function deleteSpecialty(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown specialty." };

  const admin = createAdminClient();

  // subjects.specialty_id is ON DELETE RESTRICT; pre-flight for a friendly
  // message instead of surfacing the FK error.
  const { count } = await admin
    .from("subjects")
    .select("id", { count: "exact", head: true })
    .eq("specialty_id", id.data);

  if ((count ?? 0) > 0) {
    return {
      error: `That specialty still has ${count} subject${count === 1 ? "" : "s"}. Delete or move them first.`,
    };
  }

  const { error } = await admin.from("specialties").delete().eq("id", id.data);
  if (error) {
    return {
      error:
        error.code === FK_VIOLATION
          ? "That specialty still has subjects attached."
          : "Could not delete the specialty.",
    };
  }

  await audit(user.id, "specialty.delete", id.data);
  revalidateTaxonomy();
  return { success: "Specialty deleted." };
}

/** Swap position with the neighbour — exams/specialties twin of `reorder`. */
export async function reorderExamLevel(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const table =
    formData.get("table") === "specialties" ? "specialties" : "exams";
  const id = uuid().safeParse(formData.get("id"));
  const direction = formData.get("direction") === "up" ? "up" : "down";
  if (!id.success) return { error: "Unknown row." };

  const admin = createAdminClient();

  // Branch explicitly — same reasoning as subjects reorder: the two
  // tables differ and TS can't narrow `.eq()` through a union table name.
  type Sibling = { id: string; name: string; position: number };
  let siblings: Sibling[] = [];

  if (table === "specialties") {
    const { data: row } = await admin
      .from("specialties")
      .select("exam_id")
      .eq("id", id.data)
      .maybeSingle();
    if (!row) return { error: "Unknown specialty." };

    const { data } = await admin
      .from("specialties")
      .select("id, name, position")
      .eq("exam_id", row.exam_id);
    siblings = data ?? [];
  } else {
    const { data } = await admin.from("exams").select("id, name, position");
    siblings = data ?? [];
  }

  const ordered = [...siblings].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name)
  );
  const index = ordered.findIndex((s) => s.id === id.data);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= ordered.length) {
    return { success: "Already at the end." };
  }

  const reordered = [...ordered];
  [reordered[index], reordered[swapWith]] = [
    reordered[swapWith],
    reordered[index],
  ];

  await Promise.all(
    reordered.map((r, position) =>
      table === "specialties"
        ? admin.from("specialties").update({ position }).eq("id", r.id)
        : admin.from("exams").update({ position }).eq("id", r.id)
    )
  );

  await audit(
    user.id,
    table === "specialties" ? "specialty.reorder" : "exam.reorder",
    id.data,
    { direction }
  );
  revalidateTaxonomy();
  return { success: "Reordered." };
}

// ── exam documents ──────────────────────────────────────────

/** Admin card + the student page both have to move when a document does. */
function revalidateDocuments() {
  revalidatePath("/admin/exams/[id]", "page");
  revalidatePath("/resources");
}

/**
 * Mint a one-time signed upload URL (browser → Storage, bytes never pass
 * through Next). Validates mime + size BEFORE signing; the bucket's own
 * allowed_mime_types / file_size_limit is the second layer.
 */
export async function createExamDocumentUploadUrl(
  examId: string,
  contentType: string,
  sizeBytes: number
): Promise<
  { ok: true; path: string; token: string } | { ok: false; error: string }
> {
  await requireAdmin();

  const id = uuid().safeParse(examId);
  if (!id.success) return { ok: false, error: "Unknown exam." };

  const problem = examDocumentUploadProblem(contentType, sizeBytes);
  if (problem) return { ok: false, error: problem };

  const ext = examDocumentExtensionForType(contentType);
  if (!ext) return { ok: false, error: "Unsupported file type." };

  const admin = createAdminClient();
  const { data: exam } = await admin
    .from("exams")
    .select("id")
    .eq("id", id.data)
    .maybeSingle();
  if (!exam) return { ok: false, error: "Unknown exam." };

  // uuid-unique per upload, so replacing a document never needs upsert on the
  // old object — the stale one is orphaned, same trade-off as course files.
  const path = `exams/${id.data}/${crypto.randomUUID()}.${ext}`;
  // Prove mint and confirm agree. Postgres uuid equality is case-insensitive,
  // so an uppercase-hex exam id resolves an exam here and then signs a path
  // the lowercase-only validator rejects at confirm — the object would upload
  // into a slot no row could ever point at.
  if (!isExamDocumentPath(path)) return { ok: false, error: "Unknown exam." };

  const { data, error } = await admin.storage
    .from(EXAM_DOCUMENT_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "Could not start the upload." };
  return { ok: true, path: data.path, token: data.token };
}

/**
 * Drop an object that was uploaded but never confirmed — the admin picked the
 * wrong file and discarded it before saving.
 *
 * Does NOT close the orphan problem: navigating away mid-upload still strands
 * an object, and only a storage sweep can catch those (course-content has the
 * same gap). This removes the one case the UI actually knows about, which at
 * 50 MB a file is worth doing.
 */
export async function discardExamDocumentUpload(
  path: string
): Promise<void> {
  await requireAdmin();
  // The path is client-supplied and about to be handed to a service-role
  // delete. Nothing outside the shape this module mints may be removed.
  if (!isExamDocumentPath(path)) return;

  const admin = createAdminClient();
  // An object a row already points at is a live document, not a stray upload;
  // deleting it here would leave that row pointing at nothing.
  const { data: claimed } = await admin
    .from("exam_documents")
    .select("id")
    .eq("file_path", path)
    .maybeSingle();
  if (claimed) return;

  await admin.storage.from(EXAM_DOCUMENT_BUCKET).remove([path]);
}

/** Confirm an upload: the row is what makes the object reachable. */
export async function createExamDocument(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const parsed = examDocumentSchema.safeParse({
    examId: formData.get("examId"),
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    path: formData.get("path"),
    fileName: formData.get("fileName"),
    fileSize: formData.get("fileSize"),
    contentType: formData.get("contentType"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { examId, title, description, path, fileName, fileSize, contentType } =
    parsed.data;

  // The path is client-supplied and will later be read with the service-role
  // client, which ignores RLS. Pin the shape AND the exam it names — a
  // well-formed path for a different exam must not file a row here.
  if (examDocumentPathExamId(path) !== examId) {
    return { error: "That upload doesn't belong to this exam." };
  }
  // Re-run the same check the mint did: the browser could have uploaded
  // something other than what it asked to sign for.
  const problem = examDocumentUploadProblem(contentType, fileSize);
  if (problem) return { error: problem };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("exam_documents")
    .select("position")
    .eq("exam_id", examId)
    .is("deleted_at", null);

  const { data, error } = await admin
    .from("exam_documents")
    .insert({
      exam_id: examId,
      title,
      description,
      file_path: path,
      file_name: fileName,
      file_size: fileSize,
      content_type: contentType,
      position: nextPosition(existing ?? []),
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { error: "Could not save the document." };

  await audit(user.id, "exam.document.create", data.id, { examId, title });
  revalidateDocuments();
  return { success: `Uploaded ${title}.` };
}

export async function renameExamDocument(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const parsed = examDocumentEditSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const admin = createAdminClient();
  // Same deleted_at filter the update applies — otherwise the audit meta can
  // name a row the update never touched.
  const { data: before } = await admin
    .from("exam_documents")
    .select("title")
    .eq("id", parsed.data.id)
    .is("deleted_at", null)
    .maybeSingle();

  // .select().maybeSingle() so a zero-row update is distinguishable from a
  // successful one: a document deleted in another tab must not report "Saved."
  // and write an audit row for a no-op.
  const { data: updated, error } = await admin
    .from("exam_documents")
    .update({
      title: parsed.data.title,
      description: parsed.data.description,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) return { error: "Could not save the document." };
  if (!updated) return { error: "That document is no longer there." };

  await audit(user.id, "exam.document.rename", parsed.data.id, {
    before: before?.title,
    after: parsed.data.title,
  });
  revalidateDocuments();
  return { success: "Saved." };
}

export async function setExamDocumentVisibility(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown document." };
  const isPublished = formData.get("isPublished") === "true";

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("exam_documents")
    .update({ is_published: isPublished, updated_at: new Date().toISOString() })
    .eq("id", id.data)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) return { error: "Could not update the document." };
  if (!updated) return { error: "That document is no longer there." };

  await audit(user.id, "exam.document.visibility", id.data, { isPublished });
  revalidateDocuments();
  return {
    success: isPublished ? "Published." : "Hidden from students.",
  };
}

export async function deleteExamDocument(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown document." };

  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("exam_documents")
    .select("title, file_path")
    .eq("id", id.data)
    .is("deleted_at", null)
    .maybeSingle();
  if (!doc) return { error: "That document is already gone." };

  const { error } = await admin
    .from("exam_documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id.data);
  if (error) return { error: "Could not delete the document." };

  // The ROW is soft-deleted so the audit trail still resolves; the BYTES are
  // not kept. Nothing references a deleted document — there is no past paper
  // to stay intact here, as there is for questions — and a 50 MB PDF left in
  // the bucket is pure cost. Storage failure is not fatal: the row is already
  // gone from every read path, so a stray object is the harmless outcome.
  await admin.storage.from(EXAM_DOCUMENT_BUCKET).remove([doc.file_path]);

  await audit(user.id, "exam.document.delete", id.data, { title: doc.title });
  revalidateDocuments();
  return { success: `Deleted ${doc.title}.` };
}
