"use server";

import { revalidatePath } from "next/cache";
import { requireOrgAdmin, listOrgDepartments } from "@/lib/orgs";
import { MAX_ORG_DEPARTMENTS } from "@/lib/orgs-core";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { orgDepartmentNameSchema, uuid } from "@/lib/validation";
import type { OrgMember } from "@/lib/supabase/types";
import type { OrgActionState } from "./actions";

/**
 * Department CRUD + member reassignment. Split from actions.ts to keep the
 * invite machinery readable; same gate discipline — requireOrgAdmin() is the
 * FIRST statement of every action, outside any try/catch.
 */

const UNIQUE_VIOLATION = "23505";

/** Department changes alter what MEMBERS see (their label, their assignment
 * list), not just the org pages — hence the wide fan-out. */
function revalidateDepartments() {
  for (const path of ["/org/members", "/org", "/org/assignments", "/dashboard", "/assignments", "/profile"]) {
    revalidatePath(path);
  }
}

export async function createDepartment(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const name = orgDepartmentNameSchema.safeParse(formData.get("name"));
  if (!name.success) return { error: name.error.issues[0].message };

  const existing = await listOrgDepartments(session.org.id);
  if (existing.length >= MAX_ORG_DEPARTMENTS) {
    return { error: `An organisation can have at most ${MAX_ORG_DEPARTMENTS} departments.` };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_departments")
    .insert({ org_id: session.org.id, name: name.data })
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return {
      error:
        error?.code === UNIQUE_VIOLATION
          ? "A department with that name already exists."
          : "Could not create the department.",
    };
  }

  await audit(
    session.user.id,
    "org.department_create",
    data.id,
    { name: name.data },
    session.org.id
  );
  revalidateDepartments();
  return { success: `Created ${name.data}.` };
}

export async function renameDepartment(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const id = uuid().safeParse(formData.get("departmentId"));
  const name = orgDepartmentNameSchema.safeParse(formData.get("name"));
  if (!id.success) return { error: "Unknown department." };
  if (!name.success) return { error: name.error.issues[0].message };

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("org_departments")
    .select("name")
    .eq("id", id.data)
    .eq("org_id", session.org.id)
    .maybeSingle();
  if (!before) return { error: "Unknown department." };
  if (before.name === name.data) return { success: "No change." };

  const { error } = await admin
    .from("org_departments")
    .update({ name: name.data, updated_at: new Date().toISOString() })
    .eq("id", id.data)
    .eq("org_id", session.org.id);
  if (error) {
    return {
      error:
        error.code === UNIQUE_VIOLATION
          ? "A department with that name already exists."
          : "Could not rename the department.",
    };
  }

  await audit(
    session.user.id,
    "org.department_rename",
    id.data,
    { before: before.name, after: name.data },
    session.org.id
  );
  revalidateDepartments();
  return { success: "Department renamed." };
}

export async function deleteDepartment(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const id = uuid().safeParse(formData.get("departmentId"));
  if (!id.success) return { error: "Unknown department." };

  const admin = createAdminClient();

  // Pre-read who is in the department: the FK's SET NULL clears their
  // department_id but cannot clear department_changed_at, and the invariant
  // is "timestamp meaningful only while department_id is set".
  const { data: memberRows } = await admin
    .from("org_members")
    .select("user_id")
    .eq("org_id", session.org.id)
    .eq("department_id", id.data);
  const memberIds = (memberRows ?? []).map((m) => m.user_id);

  const { data, error } = await admin
    .from("org_departments")
    .delete()
    .eq("id", id.data)
    .eq("org_id", session.org.id)
    .select("name")
    .maybeSingle();
  if (error || !data) return { error: "That department is gone already." };

  // No transaction spans delete + cleanup: a crash here leaves a stale
  // timestamp on rows whose department_id is already null, which nothing
  // reads — benign, so not worth an RPC. The department_id-is-null guard
  // matters: a member reassigned to ANOTHER department between our pre-read
  // and this update must keep their fresh timestamp, or the cohort rule
  // would count them into every one of that department's assignments.
  if (memberIds.length > 0) {
    await admin
      .from("org_members")
      .update({ department_changed_at: null })
      .eq("org_id", session.org.id)
      .in("user_id", memberIds)
      .is("department_id", null);
  }

  await audit(
    session.user.id,
    "org.department_delete",
    id.data,
    { name: data.name, membersUnassigned: memberIds.length },
    session.org.id
  );
  revalidateDepartments();
  return {
    success: `Deleted ${data.name}. ${memberIds.length} member${memberIds.length === 1 ? "" : "s"} now unassigned.`,
  };
}

export async function setMemberDepartment(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const id = uuid().safeParse(formData.get("userId"));
  if (!id.success) return { error: "Unknown member." };

  // "" = unassign; anything else must be a department of THIS org.
  const rawDept = String(formData.get("departmentId") ?? "");
  let departmentId: string | null = null;
  if (rawDept !== "") {
    const dept = uuid().safeParse(rawDept);
    if (!dept.success) return { error: "Unknown department." };
    departmentId = dept.data;
  }

  const admin = createAdminClient();
  const [{ data: target }, departments] = await Promise.all([
    admin
      .from("org_members")
      .select("*")
      .eq("org_id", session.org.id)
      .eq("user_id", id.data)
      .maybeSingle(),
    listOrgDepartments(session.org.id),
  ]);
  if (!target) return { error: "Unknown member." };

  const nameOf = new Map(departments.map((d) => [d.id, d.name]));
  if (departmentId !== null && !nameOf.has(departmentId)) {
    return { error: "Unknown department." };
  }

  const before = (target as OrgMember).department_id;
  if (before === departmentId) return { success: "No change." };

  const { error } = await admin
    .from("org_members")
    .update({
      department_id: departmentId,
      department_changed_at: departmentId ? new Date().toISOString() : null,
    })
    .eq("org_id", session.org.id)
    .eq("user_id", id.data);
  if (error) return { error: "Could not move the member." };

  await audit(
    session.user.id,
    "org.member_department_change",
    id.data,
    {
      before,
      after: departmentId,
      beforeName: before ? (nameOf.get(before) ?? null) : null,
      afterName: departmentId ? (nameOf.get(departmentId) ?? null) : null,
    },
    session.org.id
  );
  revalidateDepartments();
  return { success: "Member moved." };
}
