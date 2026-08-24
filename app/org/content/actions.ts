"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrgAdmin } from "@/lib/orgs";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import {
  examInScope,
  specialtyInScope,
  subjectInScope,
} from "@/lib/admin/content-scope";
import { nextPosition } from "@/lib/admin/taxonomy";
import type { OrgActionState } from "@/app/org/members/actions";
import { uuid } from "@/lib/validation";
import { z } from "zod";

/**
 * Org taxonomy CRUD — the private bank's exam → specialty → subject tree
 * (SPEC §6). Deliberately NOT the admin taxonomy actions: those carry
 * storefront rules (availability toggles, sold-exam delete blocks) that
 * do not exist for org banks, which are never sold. Question rules DO stay
 * shared — see app/admin/questions/actions.ts.
 *
 * Every action calls requireOrgAdmin() first, outside try/catch, and pins
 * targets to the caller's org before writing.
 */

const nameSchema = z.string().trim().min(2, "Name it").max(120, "Too long");

function revalidateContent() {
  revalidatePath("/org/content");
  revalidatePath("/org/content/questions");
  // Platform admins see org banks in their taxonomy surfaces too.
  revalidatePath("/admin/exams");
  revalidatePath("/admin/subjects");
}

export async function createOrgExam(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const name = nameSchema.safeParse(formData.get("name"));
  if (!name.success) return { error: name.error.issues[0].message };

  const admin = createAdminClient();
  const { data: siblings } = await admin
    .from("exams")
    .select("position")
    .eq("org_id", session.org.id);

  const { data, error } = await admin
    .from("exams")
    .insert({
      name: name.data,
      org_id: session.org.id,
      // Never sold: is_active is a storefront concept and org exams must
      // stay out of every selling surface regardless of this flag.
      is_active: false,
      position: nextPosition(siblings ?? []),
    })
    .select("id")
    .single();
  if (error || !data) {
    // Unique within the org (exams_org_name_key) — the one failure a user
    // can actually act on, so name it rather than the generic fallback.
    return {
      error:
        error?.code === "23505"
          ? "You already have an exam with that name."
          : "Could not create the exam.",
    };
  }

  await audit(
    session.user.id,
    "exam.create",
    data.id,
    { name: name.data, org: true },
    session.org.id
  );
  revalidateContent();
  return { success: "Exam created." };
}

export async function renameOrgExam(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const id = uuid().safeParse(formData.get("examId"));
  const name = nameSchema.safeParse(formData.get("name"));
  if (!id.success) return { error: "Unknown exam." };
  if (!name.success) return { error: name.error.issues[0].message };

  const admin = createAdminClient();
  if (!(await examInScope(admin, id.data, { kind: "org", orgId: session.org.id }))) {
    return { error: "Unknown exam." };
  }

  const { error } = await admin
    .from("exams")
    .update({ name: name.data })
    .eq("id", id.data);
  if (error) {
    return {
      error:
        error.code === "23505"
          ? "You already have an exam with that name."
          : "Could not rename the exam.",
    };
  }

  await audit(
    session.user.id,
    "exam.rename",
    id.data,
    { name: name.data },
    session.org.id
  );
  revalidateContent();
  return { success: "Renamed." };
}

export async function deleteOrgExam(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const id = uuid().safeParse(formData.get("examId"));
  if (!id.success) return { error: "Unknown exam." };

  const admin = createAdminClient();
  if (!(await examInScope(admin, id.data, { kind: "org", orgId: session.org.id }))) {
    return { error: "Unknown exam." };
  }

  // Empty-only hard delete: past papers reference questions, so anything
  // with content below it must be emptied deliberately, level by level.
  const { count } = await admin
    .from("specialties")
    .select("id", { count: "exact", head: true })
    .eq("exam_id", id.data);
  if ((count ?? 0) > 0) {
    return { error: "Delete its specialties first — the exam isn't empty." };
  }

  const { error } = await admin.from("exams").delete().eq("id", id.data);
  if (error) return { error: "Could not delete the exam." };

  await audit(session.user.id, "exam.delete", id.data, undefined, session.org.id);
  revalidateContent();
  // The delete lives on the exam's own detail page — don't leave the user
  // standing on a page that now 404s.
  redirect("/org/content");
}

export async function createOrgSpecialty(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const examId = uuid().safeParse(formData.get("examId"));
  const name = nameSchema.safeParse(formData.get("name"));
  if (!examId.success) return { error: "Unknown exam." };
  if (!name.success) return { error: name.error.issues[0].message };

  const admin = createAdminClient();
  if (
    !(await examInScope(admin, examId.data, { kind: "org", orgId: session.org.id }))
  ) {
    return { error: "Unknown exam." };
  }

  const { data: siblings } = await admin
    .from("specialties")
    .select("position")
    .eq("exam_id", examId.data);

  const { data, error } = await admin
    .from("specialties")
    .insert({
      exam_id: examId.data,
      name: name.data,
      position: nextPosition(siblings ?? []),
    })
    .select("id")
    .single();
  if (error || !data) return { error: "Could not create the specialty." };

  await audit(
    session.user.id,
    "specialty.create",
    data.id,
    { name: name.data, examId: examId.data },
    session.org.id
  );
  revalidateContent();
  return { success: "Specialty created." };
}

export async function renameOrgSpecialty(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const id = uuid().safeParse(formData.get("specialtyId"));
  const name = nameSchema.safeParse(formData.get("name"));
  if (!id.success) return { error: "Unknown specialty." };
  if (!name.success) return { error: name.error.issues[0].message };

  const admin = createAdminClient();
  if (
    !(await specialtyInScope(admin, id.data, { kind: "org", orgId: session.org.id }))
  ) {
    return { error: "Unknown specialty." };
  }

  const { error } = await admin
    .from("specialties")
    .update({ name: name.data })
    .eq("id", id.data);
  if (error) return { error: "Could not rename the specialty." };

  await audit(
    session.user.id,
    "specialty.rename",
    id.data,
    { name: name.data },
    session.org.id
  );
  revalidateContent();
  return { success: "Renamed." };
}

export async function deleteOrgSpecialty(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const id = uuid().safeParse(formData.get("specialtyId"));
  if (!id.success) return { error: "Unknown specialty." };

  const admin = createAdminClient();
  if (
    !(await specialtyInScope(admin, id.data, { kind: "org", orgId: session.org.id }))
  ) {
    return { error: "Unknown specialty." };
  }

  const { count } = await admin
    .from("subjects")
    .select("id", { count: "exact", head: true })
    .eq("specialty_id", id.data);
  if ((count ?? 0) > 0) {
    return { error: "Delete its subjects first — the specialty isn't empty." };
  }

  const { error } = await admin.from("specialties").delete().eq("id", id.data);
  if (error) return { error: "Could not delete the specialty." };

  await audit(
    session.user.id,
    "specialty.delete",
    id.data,
    undefined,
    session.org.id
  );
  revalidateContent();
  return { success: "Specialty deleted." };
}

export async function createOrgSubject(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const specialtyId = uuid().safeParse(formData.get("specialtyId"));
  const name = nameSchema.safeParse(formData.get("name"));
  if (!specialtyId.success) return { error: "Unknown specialty." };
  if (!name.success) return { error: name.error.issues[0].message };

  const admin = createAdminClient();
  if (
    !(await specialtyInScope(admin, specialtyId.data, {
      kind: "org",
      orgId: session.org.id,
    }))
  ) {
    return { error: "Unknown specialty." };
  }

  const { data: siblings } = await admin
    .from("subjects")
    .select("position")
    .eq("specialty_id", specialtyId.data);

  const { data, error } = await admin
    .from("subjects")
    .insert({
      specialty_id: specialtyId.data,
      name: name.data,
      position: nextPosition(siblings ?? []),
    })
    .select("id")
    .single();
  if (error || !data) return { error: "Could not create the subject." };

  await audit(
    session.user.id,
    "subject.create",
    data.id,
    { name: name.data, specialtyId: specialtyId.data },
    session.org.id
  );
  revalidateContent();
  return { success: "Subject created." };
}

export async function renameOrgSubject(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const id = uuid().safeParse(formData.get("subjectId"));
  const name = nameSchema.safeParse(formData.get("name"));
  if (!id.success) return { error: "Unknown subject." };
  if (!name.success) return { error: name.error.issues[0].message };

  const admin = createAdminClient();
  if (
    !(await subjectInScope(admin, id.data, { kind: "org", orgId: session.org.id }))
  ) {
    return { error: "Unknown subject." };
  }

  const { error } = await admin
    .from("subjects")
    .update({ name: name.data })
    .eq("id", id.data);
  if (error) return { error: "Could not rename the subject." };

  await audit(
    session.user.id,
    "subject.rename",
    id.data,
    { name: name.data },
    session.org.id
  );
  revalidateContent();
  return { success: "Renamed." };
}

export async function deleteOrgSubject(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const id = uuid().safeParse(formData.get("subjectId"));
  if (!id.success) return { error: "Unknown subject." };

  const admin = createAdminClient();
  if (
    !(await subjectInScope(admin, id.data, { kind: "org", orgId: session.org.id }))
  ) {
    return { error: "Unknown subject." };
  }

  // Soft-deleted questions still hold their FK and still block this —
  // deliberately, since past papers resolve through them.
  const { count } = await admin
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("subject_id", id.data);
  if ((count ?? 0) > 0) {
    return {
      error: "This subject still has questions (deleted ones included).",
    };
  }

  const { error } = await admin.from("subjects").delete().eq("id", id.data);
  if (error) return { error: "Could not delete the subject." };

  await audit(
    session.user.id,
    "subject.delete",
    id.data,
    undefined,
    session.org.id
  );
  revalidateContent();
  return { success: "Subject deleted." };
}
