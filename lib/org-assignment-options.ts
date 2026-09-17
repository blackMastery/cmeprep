import "server-only";

import { listExamCatalogTree } from "@/lib/catalog";
import { orgAccessOf } from "@/lib/entitlements-core";
import {
  listOrgDepartments,
  listOrgMembers,
  listOrgSubscriptions,
  type OrgAdminSession,
} from "@/lib/orgs";
import type {
  AssignmentExamOption,
  DepartmentOption,
  MemberOption,
} from "@/components/org/assignment-form";

/**
 * Everything the assignment form offers: entitled exams with their
 * subjects, the roster and the departments.
 *
 * Shared by /org/assignments (the edit dialog) and /org/assignments/new so
 * the two surfaces cannot drift on WHICH exams may be assigned — the rule
 * below is the same one the create/update actions enforce, and offering an
 * unentitled exam would only fail at the action.
 */
export type AssignmentFormOptions = {
  exams: AssignmentExamOption[];
  members: MemberOption[];
  departments: DepartmentOption[];
};

export async function loadAssignmentFormOptions(
  session: OrgAdminSession
): Promise<AssignmentFormOptions> {
  // RLS narrows the catalogue to public + own bank; the entitlement filter
  // below narrows further to what the org's per-exam plan actually covers.
  const [tree, members, orgSubs, departments] = await Promise.all([
    listExamCatalogTree(),
    listOrgMembers(session.org.id),
    listOrgSubscriptions(session.org.id),
    listOrgDepartments(session.org.id),
  ]);

  const orgAccess = orgAccessOf(
    {
      org_id: session.org.id,
      suspended_at: session.org.suspended_at,
      subs: orgSubs,
    },
    new Date()
  );

  const exams: AssignmentExamOption[] = tree
    .filter(
      (exam) =>
        exam.orgId !== null ||
        (orgAccess !== null &&
          (orgAccess.allAccess || orgAccess.examIds.includes(exam.id)))
    )
    .map((exam) => ({
      id: exam.id,
      name: exam.name,
      isPrivate: exam.orgId !== null,
      // Specialty stays its own field rather than being folded into the
      // name: the picker is a table and gives it a column, which is what
      // stopped every row reading "Internal Medicine · Neph…".
      subjects: exam.specialties.flatMap((sp) =>
        sp.subjects
          .filter((s) => s.questionCount > 0)
          .map((s) => ({
            id: s.id,
            name: s.name,
            specialty: sp.name,
            questionCount: s.questionCount,
          }))
      ),
    }))
    .filter((exam) => exam.subjects.length > 0);

  return {
    exams,
    members: members.map((row) => ({
      userId: row.member.user_id,
      label: row.profile?.full_name ?? row.email ?? row.member.user_id,
    })),
    departments: departments.map((d) => ({ id: d.id, name: d.name })),
  };
}
