"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { nextPosition } from "@/lib/admin/taxonomy";
import { subjectSchema, topicSchema, uuid } from "@/lib/validation";

export type AdminState = { error?: string; success?: string } | null;

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = "23505";
const FK_VIOLATION = "23503";

/**
 * Explain a blocked delete precisely.
 *
 * The confusing case is a subject/topic that looks empty but still can't be
 * deleted, because soft-deleted questions keep their foreign key. Saying
 * "still has 1 question" when the UI shows none is maddening, so name the
 * deleted ones explicitly.
 */
function blockedMessage(
  kind: "subject" | "topic",
  total: number,
  live: number
): string {
  const deleted = total - live;
  const move =
    kind === "topic"
      ? "Move them to another topic first."
      : "Move or delete them first.";

  if (live === 0 && deleted > 0) {
    return `That ${kind} has no live questions, but ${deleted} deleted question${deleted === 1 ? "" : "s"} still reference${deleted === 1 ? "s" : ""} it. Deleted questions are kept so past papers stay intact, so the ${kind} can't be removed.`;
  }

  if (deleted > 0) {
    return `That ${kind} still has ${live} question${live === 1 ? "" : "s"} (plus ${deleted} deleted). ${move}`;
  }

  return `That ${kind} still has ${total} question${total === 1 ? "" : "s"}. ${move}`;
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
  revalidatePath("/admin/subjects");
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
  revalidatePath("/admin/subjects");
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

  // Pre-flight rather than relying on the FK error. Counts soft-deleted
  // questions too — they still hold their FK to topics, so they still block
  // the delete even though the UI shows them as gone.
  const { count } = await admin
    .from("questions")
    .select("id, topics!inner(subject_id)", { count: "exact", head: true })
    .eq("topics.subject_id", id.data);

  const { count: liveCount } = await admin
    .from("questions")
    .select("id, topics!inner(subject_id)", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("topics.subject_id", id.data);

  if ((count ?? 0) > 0) {
    return { error: blockedMessage("subject", count ?? 0, liveCount ?? 0) };
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
  revalidatePath("/admin/subjects");
  return { success: "Subject deleted." };
}

export async function createTopic(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const parsed = topicSchema.safeParse({
    subjectId: formData.get("subjectId"),
    name: formData.get("name"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const admin = createAdminClient();
  const { data: siblings } = await admin
    .from("topics")
    .select("position")
    .eq("subject_id", parsed.data.subjectId);

  const { data, error } = await admin
    .from("topics")
    .insert({
      subject_id: parsed.data.subjectId,
      name: parsed.data.name,
      position: nextPosition(siblings ?? []),
    })
    .select("id")
    .single();

  if (error) {
    return {
      error:
        error.code === UNIQUE_VIOLATION
          ? "That subject already has a topic with this name."
          : "Could not create the topic.",
    };
  }

  await audit(user.id, "topic.create", data.id, {
    name: parsed.data.name,
    subjectId: parsed.data.subjectId,
  });
  revalidatePath("/admin/subjects");
  return { success: `Created ${parsed.data.name}.` };
}

export async function renameTopic(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  if (!id.success) return { error: "Unknown topic." };
  if (name.length < 2) return { error: "Topic name is too short" };

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("topics")
    .select("name")
    .eq("id", id.data)
    .maybeSingle();

  const { error } = await admin.from("topics").update({ name }).eq("id", id.data);
  if (error) {
    return {
      error:
        error.code === UNIQUE_VIOLATION
          ? "That subject already has a topic with this name."
          : "Could not rename the topic.",
    };
  }

  await audit(user.id, "topic.rename", id.data, {
    before: before?.name,
    after: name,
  });
  revalidatePath("/admin/subjects");
  return { success: "Renamed." };
}

export async function deleteTopic(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown topic." };

  const admin = createAdminClient();

  // Again, no deleted_at filter — soft-deleted questions keep their FK.
  const { count } = await admin
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("topic_id", id.data);

  const { count: liveCount } = await admin
    .from("questions")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("topic_id", id.data);

  if ((count ?? 0) > 0) {
    return { error: blockedMessage("topic", count ?? 0, liveCount ?? 0) };
  }

  const { error } = await admin.from("topics").delete().eq("id", id.data);
  if (error) {
    return {
      error:
        error.code === FK_VIOLATION
          ? "That topic still has questions attached."
          : "Could not delete the topic.",
    };
  }

  await audit(user.id, "topic.delete", id.data);
  revalidatePath("/admin/subjects");
  return { success: "Topic deleted." };
}

/** Move every question from one topic to another, so the source can be deleted. */
export async function moveTopicQuestions(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const from = uuid().safeParse(formData.get("fromTopicId"));
  const to = uuid().safeParse(formData.get("toTopicId"));
  if (!from.success || !to.success) return { error: "Choose a destination topic." };
  if (from.data === to.data) return { error: "Pick a different destination." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("questions")
    .update({ topic_id: to.data, updated_at: new Date().toISOString() })
    .eq("topic_id", from.data)
    .select("id");

  if (error) return { error: "Could not move the questions." };

  await audit(user.id, "topic.move_questions", from.data, {
    to: to.data,
    moved: data?.length ?? 0,
  });
  revalidatePath("/admin/subjects");
  revalidatePath("/admin/questions");
  return { success: `Moved ${data?.length ?? 0} question(s).` };
}

/** Swap position with the neighbour in the given direction. */
export async function reorder(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const table = formData.get("table") === "topics" ? "topics" : "subjects";
  const id = uuid().safeParse(formData.get("id"));
  const direction = formData.get("direction") === "up" ? "up" : "down";
  if (!id.success) return { error: "Unknown row." };

  const admin = createAdminClient();

  // Branch explicitly rather than threading a union table name through — the
  // two tables have different columns and TS can't narrow `.eq()` otherwise.
  type Sibling = { id: string; name: string; position: number };
  let siblings: Sibling[] = [];

  if (table === "topics") {
    const { data: row } = await admin
      .from("topics")
      .select("subject_id")
      .eq("id", id.data)
      .maybeSingle();
    if (!row) return { error: "Unknown topic." };

    const { data } = await admin
      .from("topics")
      .select("id, name, position")
      .eq("subject_id", row.subject_id);
    siblings = data ?? [];
  } else {
    // Subjects order within their specialty, mirroring the topics branch.
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
    siblings = data ?? [];
  }

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
      table === "topics"
        ? admin.from("topics").update({ position }).eq("id", r.id)
        : admin.from("subjects").update({ position }).eq("id", r.id)
    )
  );

  await audit(
    user.id,
    table === "topics" ? "topic.reorder" : "subject.reorder",
    id.data,
    { direction }
  );
  revalidatePath("/admin/subjects");
  return { success: "Reordered." };
}
