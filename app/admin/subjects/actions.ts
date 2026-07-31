"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { nextPosition } from "@/lib/admin/taxonomy";
import { subjectSchema, uuid } from "@/lib/validation";

export type AdminState = { error?: string; success?: string } | null;

function revalidateSubjects() {
  revalidatePath("/admin/subjects");
  // "page" scope so every /admin/subjects/[id] instance is invalidated, not
  // just the literal path — a rename has to land on the detail page it came
  // from.
  revalidatePath("/admin/subjects/[id]", "page");
}

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = "23505";
const FK_VIOLATION = "23503";

/**
 * Explain a blocked delete precisely.
 *
 * The confusing case is a subject that looks empty but still can't be
 * deleted, because soft-deleted questions keep their foreign key. Saying
 * "still has 1 question" when the UI shows none is maddening, so name the
 * deleted ones explicitly.
 */
function blockedMessage(total: number, live: number): string {
  const deleted = total - live;
  const move = "Move or delete them first.";

  if (live === 0 && deleted > 0) {
    return `That subject has no live questions, but ${deleted} deleted question${deleted === 1 ? "" : "s"} still reference${deleted === 1 ? "s" : ""} it. Deleted questions are kept so past papers stay intact, so the subject can't be removed.`;
  }

  if (deleted > 0) {
    return `That subject still has ${live} question${live === 1 ? "" : "s"} (plus ${deleted} deleted). ${move}`;
  }

  return `That subject still has ${total} question${total === 1 ? "" : "s"}. ${move}`;
}

/**
 * Every action calls requireAdmin() as its FIRST statement, outside any
 * try/catch. The admin layout does not protect these — an action POST runs
 * its mutation before any layout renders — and requireAdmin() works by
 * throwing NEXT_REDIRECT, which a catch block would swallow.
 */

export async function createSubject(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const parsed = subjectSchema.safeParse({
    specialtyId: formData.get("specialtyId"),
    name: formData.get("name"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const admin = createAdminClient();
  const { data: siblings } = await admin
    .from("subjects")
    .select("position")
    .eq("specialty_id", parsed.data.specialtyId);

  const { data, error } = await admin
    .from("subjects")
    .insert({
      specialty_id: parsed.data.specialtyId,
      name: parsed.data.name,
      position: nextPosition(siblings ?? []),
    })
    .select("id")
    .single();

  if (error) {
    return {
      error:
        error.code === UNIQUE_VIOLATION
          ? "That specialty already has a subject with this name."
          : "Could not create the subject.",
    };
  }

  await audit(user.id, "subject.create", data.id, {
    name: parsed.data.name,
    specialtyId: parsed.data.specialtyId,
  });
  revalidateSubjects();
  return { success: `Created ${parsed.data.name}.` };
}

export async function renameSubject(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  // Rename never moves the subject, so only the name field is parsed.
  const parsed = subjectSchema.shape.name.safeParse(formData.get("name"));
  if (!id.success) return { error: "Unknown subject." };
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("subjects")
    .select("name")
    .eq("id", id.data)
    .maybeSingle();

  const { error } = await admin
    .from("subjects")
    .update({ name: parsed.data })
    .eq("id", id.data);

  if (error) {
    return {
      error:
        error.code === UNIQUE_VIOLATION
          ? "That specialty already has a subject with this name."
          : "Could not rename the subject.",
    };
  }

  await audit(user.id, "subject.rename", id.data, {
    before: before?.name,
    after: parsed.data,
  });
  revalidateSubjects();
  return { success: "Renamed." };
}

export async function deleteSubject(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown subject." };

  const admin = createAdminClient();

  // Read the parent before the row goes away — the redirect below has to land
  // back on the specialty the subject was filed under.
  const { data: parent } = await admin
    .from("subjects")
    .select("specialty_id")
    .eq("id", id.data)
    .maybeSingle();

  // Pre-flight rather than relying on the FK error. Counts soft-deleted
  // questions too — they still hold their FK to subjects, so they still block
  // the delete even though the UI shows them as gone.
  const { count } = await admin
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("subject_id", id.data);

  const { count: liveCount } = await admin
    .from("questions")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("subject_id", id.data);

  if ((count ?? 0) > 0) {
    return { error: blockedMessage(count ?? 0, liveCount ?? 0) };
  }

  const { error } = await admin.from("subjects").delete().eq("id", id.data);
  if (error) {
    return {
      error:
        error.code === FK_VIOLATION
          ? "That subject still has questions attached."
          : "Could not delete the subject.",
    };
  }

  await audit(user.id, "subject.delete", id.data);
  revalidateSubjects();

  // Delete is only offered from /admin/subjects/[id], which 404s the moment
  // the row is gone. Leave for the list instead of re-rendering a dead page.
  redirect(
    parent
      ? `/admin/subjects?specialty=${parent.specialty_id}`
      : "/admin/subjects"
  );
}

/** Swap position with the neighbour in the given direction. Subjects only — they order within their specialty. */
export async function reorder(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  const direction = formData.get("direction") === "up" ? "up" : "down";
  if (!id.success) return { error: "Unknown row." };

  const admin = createAdminClient();

  const { data: row } = await admin
    .from("subjects")
    .select("specialty_id")
    .eq("id", id.data)
    .maybeSingle();
  if (!row) return { error: "Unknown subject." };

  const { data } = await admin
    .from("subjects")
    .select("id, name, position")
    .eq("specialty_id", row.specialty_id);
  const siblings = data ?? [];

  // position defaults to 0 so ties are common — break them by name for a
  // stable order that matches what the page displays.
  const ordered = [...siblings].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name)
  );
  const index = ordered.findIndex((s) => s.id === id.data);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= ordered.length) {
    return { success: "Already at the end." };
  }

  // Renumber the whole list — cheap, and it repairs any pre-existing ties.
  const reordered = [...ordered];
  [reordered[index], reordered[swapWith]] = [
    reordered[swapWith],
    reordered[index],
  ];

  await Promise.all(
    reordered.map((r, position) =>
      admin.from("subjects").update({ position }).eq("id", r.id)
    )
  );

  await audit(user.id, "subject.reorder", id.data, { direction });
  revalidateSubjects();
  return { success: "Reordered." };
}
