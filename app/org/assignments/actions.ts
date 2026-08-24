"use server";

import { revalidatePath } from "next/cache";
import { listOrgSubscriptions, requireOrgAdmin, type OrgAdminSession } from "@/lib/orgs";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { orgAccessOf } from "@/lib/entitlements-core";
import {
  assignmentChanges,
  assignmentConfigChanged,
  assignmentEditBlocker,
  unaddressedByEdit,
  type AssignmentEdit,
} from "@/lib/orgs-core";
import { orgAssignmentSchema, uuid } from "@/lib/validation";
import type { OrgActionState } from "@/app/org/members/actions";
import type { OrgAssignment, TestConfig } from "@/lib/supabase/types";
import { z } from "zod";

/**
 * Assignment CRUD (SPEC §7). requireOrgAdmin() first, outside try/catch.
 * The config is validated at creation AND at launch (/api/tests re-checks
 * subjects and question availability) — an assignment can outlive its
 * content, and the member sees the ordinary error surface if it has.
 *
 * Create and update share one form shape and one set of resolvers below, so
 * an edited assignment obeys exactly the rules a new one does. The edit-only
 * rules (config lock, never un-address an attempt-holder, optimistic
 * concurrency) are in lib/orgs-core.ts where vitest pins them.
 */

type Admin = ReturnType<typeof createAdminClient>;
type AssignmentInput = z.infer<typeof orgAssignmentSchema>;

function revalidateAssignments() {
  revalidatePath("/org/assignments");
  revalidatePath("/assignments");
  revalidatePath("/dashboard");
}

function parseAssignmentForm(formData: FormData) {
  return orgAssignmentSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    examId: formData.get("examId"),
    subjectIds: formData.getAll("subjectIds").map(String),
    difficulty: formData.get("difficulty") ?? "mixed",
    numQuestions: formData.get("numQuestions"),
    mode: formData.get("mode") ?? "exam",
    // "" → undefined BEFORE parsing (z.coerce turns "" into 0): tutor
    // prescriptions submit no duration at all.
    durationMin: formData.get("durationMin") || undefined,
    dueDate: formData.get("dueDate"),
    audience: formData.get("audience") ?? "all",
    targetIds: formData.getAll("targetIds").map(String),
    departmentId: formData.get("departmentId") || undefined,
  });
}

/** End-of-day UTC, same convention as subscription period ends. */
function dueAtOf(input: AssignmentInput): string {
  return `${input.dueDate}T23:59:59Z`;
}

/**
 * The ONE writer of config.mode: the org's prescribed default, which the
 * launch route reads (and the member may override). Tutor prescriptions are
 * untimed, so duration_sec is simply absent.
 */
function configOf(input: AssignmentInput): TestConfig {
  return {
    subject_ids: input.subjectIds,
    difficulty: input.difficulty,
    num_questions: input.numQuestions,
    ...(input.mode === "exam" ? { duration_sec: input.durationMin! * 60 } : {}),
    exam_id: input.examId,
    mode: input.mode,
  };
}

/**
 * The exam must be one the org's members can practise: their own bank, or a
 * public exam the org's plan actually covers — org purchases are per exam,
 * so ownership alone is not entitlement. Every subject must hang off the
 * chosen exam (same integrity rule as test creation).
 */
async function checkConfigContent(
  admin: Admin,
  session: OrgAdminSession,
  input: AssignmentInput
): Promise<string | null> {
  const { data: exam } = await admin
    .from("exams")
    .select("id, org_id")
    .eq("id", input.examId)
    .maybeSingle();
  if (!exam || (exam.org_id !== null && exam.org_id !== session.org.id)) {
    return "Unknown exam.";
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
      return "Your organisation's plan doesn't include that examination.";
    }
  }

  const { data: examSubjects } = await admin
    .from("subjects")
    .select("id, specialties!inner(exam_id)")
    .in("id", input.subjectIds)
    .eq("specialties.exam_id", input.examId);
  if ((examSubjects?.length ?? 0) !== input.subjectIds.length) {
    return "Those subjects don't belong to the chosen exam.";
  }
  return null;
}

/**
 * Resolves who the assignment reaches. Department audiences are dynamic —
 * no target rows, membership resolves at read time against
 * org_members.department_id. Selected targets must be members; filtered
 * silently, since a member removed after the form rendered is not an error
 * worth blocking on.
 */
async function resolveAudience(
  admin: Admin,
  session: OrgAdminSession,
  input: AssignmentInput
): Promise<{ error: string } | { departmentId: string | null; targetIds: string[] }> {
  if (input.audience === "selected" && input.targetIds.length === 0) {
    return { error: "Pick at least one member, or assign to everyone." };
  }
  if (input.audience === "department" && !input.departmentId) {
    return { error: "Pick a department, or assign to everyone." };
  }

  let departmentId: string | null = null;
  if (input.audience === "department" && input.departmentId) {
    const { data: dept } = await admin
      .from("org_departments")
      .select("id")
      .eq("id", input.departmentId)
      .eq("org_id", session.org.id)
      .maybeSingle();
    if (!dept) return { error: "Unknown department." };
    departmentId = dept.id;
  }

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
  return { departmentId, targetIds };
}

export async function createAssignment(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const parsed = parseAssignmentForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const input = parsed.data;

  const admin = createAdminClient();

  const audienceResult = await resolveAudience(admin, session, input);
  if ("error" in audienceResult) return audienceResult;
  const { departmentId, targetIds } = audienceResult;

  const contentError = await checkConfigContent(admin, session, input);
  if (contentError) return { error: contentError };

  const config = configOf(input);
  const dueAt = dueAtOf(input);

  const { data: created, error } = await admin
    .from("org_assignments")
    .insert({
      org_id: session.org.id,
      title: input.title,
      description: input.description === "" ? null : input.description,
      config,
      due_at: dueAt,
      audience: input.audience,
      department_id: departmentId,
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
      mode: input.mode,
      dueAt,
      audience: input.audience,
      departmentId,
      targets: targetIds.length,
    },
    session.org.id
  );
  revalidateAssignments();
  return { success: "Assignment created." };
}

/**
 * Everyone who has launched this assignment, with the membership fields the
 * cohort rule needs. Paged: a plain row select is capped by PostgREST
 * max_rows (1000) and a popular assignment can exceed that in retakes.
 * People who have since left the org are dropped — they are not addressed
 * by anything (membership is required at launch and by RLS), so an edit
 * cannot un-address them.
 */
async function attemptHolders(
  admin: Admin,
  orgId: string,
  assignmentId: string
): Promise<
  { user_id: string; department_id: string | null; department_changed_at: string | null }[]
> {
  const PAGE = 1000;
  const userIds = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data: page } = await admin
      .from("tests")
      .select("user_id")
      .eq("assignment_id", assignmentId)
      .order("id")
      .range(from, from + PAGE - 1);
    for (const row of page ?? []) userIds.add(row.user_id);
    if (!page || page.length < PAGE) break;
  }
  if (userIds.size === 0) return [];

  const holders: {
    user_id: string;
    department_id: string | null;
    department_changed_at: string | null;
  }[] = [];
  const ids = [...userIds];
  for (let i = 0; i < ids.length; i += PAGE) {
    const { data } = await admin
      .from("org_members")
      .select("user_id, department_id, department_changed_at")
      .eq("org_id", orgId)
      .in("user_id", ids.slice(i, i + PAGE));
    holders.push(...(data ?? []));
  }
  return holders;
}

export async function updateAssignment(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const id = uuid().safeParse(formData.get("assignmentId"));
  const expectedUpdatedAt = z
    .string()
    .min(1)
    .safeParse(formData.get("expectedUpdatedAt"));
  if (!id.success || !expectedUpdatedAt.success) {
    return { error: "Unknown assignment." };
  }
  const parsed = parseAssignmentForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const input = parsed.data;

  const admin = createAdminClient();

  const { data: rowData } = await admin
    .from("org_assignments")
    .select("*")
    .eq("id", id.data)
    .eq("org_id", session.org.id)
    .is("deleted_at", null)
    .maybeSingle();
  const row = (rowData as OrgAssignment | null) ?? null;
  if (!row) return { error: "Unknown assignment." };
  // Optimistic concurrency: the form carries the updated_at it rendered
  // with. Compared as the strings PostgREST returned — parsing to Date and
  // back would lose the microseconds and false-positive on every save.
  const staleMessage =
    "This assignment was changed by someone else since you opened it. Reload the page and try again.";
  if (row.updated_at !== expectedUpdatedAt.data) return { error: staleMessage };

  const audienceResult = await resolveAudience(admin, session, input);
  if ("error" in audienceResult) return audienceResult;
  const { departmentId, targetIds } = audienceResult;

  // A locked (unchanged) config is kept verbatim and NOT re-validated: the
  // org's plan may have lapsed since, and blocking a deadline extension on
  // that would help nobody — the launch route enforces entitlement anyway.
  const nextConfig = configOf(input);
  const configChanged = assignmentConfigChanged(row.config, nextConfig);
  const finalConfig: TestConfig = configChanged ? nextConfig : row.config;
  if (configChanged) {
    const contentError = await checkConfigContent(admin, session, input);
    if (contentError) return { error: contentError };
  }

  const [holders, { data: currentTargetRows }] = await Promise.all([
    attemptHolders(admin, session.org.id, row.id),
    admin
      .from("org_assignment_targets")
      .select("user_id")
      .eq("assignment_id", row.id),
  ]);
  const currentTargets = (currentTargetRows ?? []).map((t) => t.user_id);

  const before: AssignmentEdit = {
    title: row.title,
    description: row.description,
    dueAt: row.due_at,
    audience: row.audience,
    departmentId: row.department_id,
    targetIds: currentTargets,
    config: row.config,
  };
  const after: AssignmentEdit = {
    title: input.title,
    description: input.description === "" ? null : input.description,
    dueAt: dueAtOf(input),
    audience: input.audience,
    departmentId,
    targetIds,
    config: finalConfig,
  };

  const blocker = assignmentEditBlocker({
    configChanged,
    startedCount: holders.length,
    unaddressed: unaddressedByEdit(holders, after).length,
  });
  if (blocker) return { error: blocker };

  const { changes, targetsAdded, targetsRemoved } = assignmentChanges(before, after);
  if (Object.keys(changes).length === 0) return { success: "No changes to save." };

  // Pinned on updated_at as well as id/org: two admins who both passed the
  // check above race here, and the loser must not overwrite the winner.
  const { data: updated } = await admin
    .from("org_assignments")
    .update({
      title: after.title,
      description: after.description,
      config: finalConfig,
      due_at: after.dueAt,
      audience: after.audience,
      department_id: after.departmentId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("org_id", session.org.id)
    .eq("updated_at", row.updated_at)
    .select("id")
    .maybeSingle();
  if (!updated) return { error: staleMessage };

  // Target rows exist only for audience='selected'; leaving that audience
  // removes them all (assignmentChanges reports exactly that).
  if (targetsRemoved.length > 0) {
    await admin
      .from("org_assignment_targets")
      .delete()
      .eq("assignment_id", row.id)
      .in("user_id", targetsRemoved);
  }
  if (targetsAdded.length > 0) {
    const { error: targetError } = await admin
      .from("org_assignment_targets")
      .upsert(
        targetsAdded.map((userId) => ({ assignment_id: row.id, user_id: userId })),
        { onConflict: "assignment_id,user_id" }
      );
    if (targetError) {
      return {
        error:
          "The assignment was saved but some members could not be added. Reload and check the audience.",
      };
    }
  }

  await audit(
    session.user.id,
    "org.assignment_update",
    row.id,
    {
      title: after.title,
      changes,
      targetsAdded: targetsAdded.length,
      targetsRemoved: targetsRemoved.length,
      startedCount: holders.length,
    },
    session.org.id
  );
  revalidateAssignments();
  return { success: "Assignment updated." };
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
