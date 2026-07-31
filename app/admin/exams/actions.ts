"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { nextPosition } from "@/lib/admin/taxonomy";
import { examSchema, specialtySchema, uuid } from "@/lib/validation";
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
  const { count } = await admin
    .from("specialties")
    .select("id", { count: "exact", head: true })
    .eq("exam_id", id.data);

  if ((count ?? 0) > 0) {
    return {
      error: `That exam still has ${count} specialt${count === 1 ? "y" : "ies"}. Delete or move them first.`,
    };
  }

  const { error } = await admin.from("exams").delete().eq("id", id.data);
  if (error) return { error: "Could not delete the exam." };

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
