"use server";

import { revalidatePath } from "next/cache";
import { listOrgSubscriptions, requireOrgAdmin } from "@/lib/orgs";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { orgAccessOf } from "@/lib/entitlements-core";
import { orgAssignmentSchema, uuid } from "@/lib/validation";
import type { OrgActionState } from "@/app/(app)/org/(manage)/members/actions";
import type { TestConfig } from "@/lib/supabase/types";

/**
 * Assignment CRUD (SPEC §7). requireOrgAdmin() first, outside try/catch.
 * The config is validated at creation AND at launch (/api/tests re-checks
 * subjects and question availability) — an assignment can outlive its
 * content, and the member sees the ordinary error surface if it has.
 */

function revalidateAssignments() {
  revalidatePath("/org/assignments");
  revalidatePath("/assignments");
  revalidatePath("/dashboard");
}

export async function createAssignment(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const parsed = orgAssignmentSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    examId: formData.get("examId"),
    subjectIds: formData.getAll("subjectIds").map(String),
    difficulty: formData.get("difficulty") ?? "mixed",
    numQuestions: formData.get("numQuestions"),
    durationMin: formData.get("durationMin"),
    dueDate: formData.get("dueDate"),
    audience: formData.get("audience") ?? "all",
    targetIds: formData.getAll("targetIds").map(String),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const input = parsed.data;

  if (input.audience === "selected" && input.targetIds.length === 0) {
    return { error: "Pick at least one member, or assign to everyone." };
  }

  const admin = createAdminClient();

  // The exam must be one the org's members can practise: their own bank, or
  // a public exam the org's plan actually covers — org purchases are per
  // exam now, so ownership alone is not entitlement.
  const { data: exam } = await admin
    .from("exams")
    .select("id, org_id")
    .eq("id", input.examId)
    .maybeSingle();
  if (!exam || (exam.org_id !== null && exam.org_id !== session.org.id)) {
    return { error: "Unknown exam." };
  }
  if (exam.org_id === null) {
    const orgAccess = orgAccessOf(
      {
        org_id: session.org.id,
        suspended_at: session.org.suspended_at,
        subs: await listOrgSubscriptions(session.org.id),
      },
      new Date()
    );
    if (
      !orgAccess ||
      (!orgAccess.allAccess && !orgAccess.examIds.includes(exam.id))
    ) {
      return {
        error: "Your organisation's plan doesn't include that examination.",
      };
    }
  }

  // Same subject-integrity rule as test creation: every subject must hang
  // off the chosen exam.
  const { data: examSubjects } = await admin
    .from("subjects")
    .select("id, specialties!inner(exam_id)")
    .in("id", input.subjectIds)
    .eq("specialties.exam_id", input.examId);
  if ((examSubjects?.length ?? 0) !== input.subjectIds.length) {
    return { error: "Those subjects don't belong to the chosen exam." };
  }

  // Targets must be members. Filter silently — a member removed since the
  // form rendered is not an error worth blocking on.
  let targetIds: string[] = [];
  if (input.audience === "selected") {
    const { data: members } = await admin
      .from("org_members")
      .select("user_id")
      .eq("org_id", session.org.id)
      .in("user_id", input.targetIds);
    targetIds = (members ?? []).map((m) => m.user_id);
    if (targetIds.length === 0) {
      return { error: "None of those people are members any more." };
    }
  }

  const config: TestConfig = {
    subject_ids: input.subjectIds,
    difficulty: input.difficulty,
    num_questions: input.numQuestions,
    duration_sec: input.durationMin * 60,
    exam_id: input.examId,
  };

  // End-of-day UTC, same convention as subscription period ends.
  const dueAt = `${input.dueDate}T23:59:59Z`;

  const { data: created, error } = await admin
    .from("org_assignments")
    .insert({
      org_id: session.org.id,
      title: input.title,
      description: input.description === "" ? null : input.description,
      config,
      due_at: dueAt,
      audience: input.audience,
      created_by: session.user.id,
    })
    .select("id")
    .single();
  if (error || !created) return { error: "Could not create the assignment." };

  if (targetIds.length > 0) {
    const { error: targetError } = await admin
      .from("org_assignment_targets")
      .insert(
        targetIds.map((userId) => ({
          assignment_id: created.id,
          user_id: userId,
        }))
      );
    if (targetError) {
      // A selected-audience assignment with no targets reaches nobody —
      // remove the husk rather than leaving it.
      await admin.from("org_assignments").delete().eq("id", created.id);
      return { error: "Could not create the assignment." };
    }
  }

  await audit(
    session.user.id,
    "org.assignment_create",
    created.id,
    {
      title: input.title,
      examId: input.examId,
      subjects: input.subjectIds.length,
      numQuestions: input.numQuestions,
      dueAt,
      audience: input.audience,
      targets: targetIds.length,
    },
    session.org.id
  );
  revalidateAssignments();
  return { success: "Assignment created." };
}

export async function deleteAssignment(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const id = uuid().safeParse(formData.get("assignmentId"));
  if (!id.success) return { error: "Unknown assignment." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_assignments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id.data)
    .eq("org_id", session.org.id)
    .is("deleted_at", null)
    .select("title")
    .maybeSingle();
  if (error || !data) return { error: "Unknown assignment." };

  await audit(
    session.user.id,
    "org.assignment_delete",
    id.data,
    { title: data.title },
    session.org.id
  );
  revalidateAssignments();
  return { success: "Assignment removed." };
}
