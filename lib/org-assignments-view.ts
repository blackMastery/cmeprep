import "server-only";

import { listExamCatalogTree } from "@/lib/catalog";
import { orgAccessOf } from "@/lib/entitlements-core";
import {
  listAssignmentProgress,
  listOrgDepartments,
  listOrgMembers,
  listOrgSubscriptions,
  type OrgAdminSession,
} from "@/lib/orgs";
import type {
  AssignmentExamOption,
  AssignmentRow,
  DepartmentOption,
  MemberOption,
} from "@/components/org/assignment-form";

/**
 * View models for the three assignment surfaces — the list, the create page
 * and the edit page — built HERE rather than in each page so they cannot
 * drift on which exams may be assigned or how a row reads.
 */

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


/**
 * The org's assignments as the list and the edit page see them: the stored
 * prescription plus the progress counts, with exam and subject names
 * resolved.
 *
 * Names come from the FULL catalogue tree, not the entitlement-filtered
 * `exams` above: a lapsed plan must not turn a locked assignment's exam
 * into "Unknown" on the edit form.
 */
export async function loadAssignmentRows(
  session: OrgAdminSession
): Promise<AssignmentRow[]> {
  const [tree, progress] = await Promise.all([
    listExamCatalogTree(),
    listAssignmentProgress(session.org.id),
  ]);

  const examName = new Map(tree.map((exam) => [exam.id, exam.name]));
  const subject = new Map(
    tree.flatMap((exam) =>
      exam.specialties.flatMap((sp) =>
        sp.subjects.map(
          (s) =>
            [
              s.id,
              { name: s.name, specialty: sp.name, questionCount: s.questionCount },
            ] as const
        )
      )
    )
  );

  return progress.map(
    ({
      assignment,
      targeted,
      completed,
      late,
      completedTutor,
      departmentName,
      started,
      targetIds,
    }) => ({
      id: assignment.id,
      title: assignment.title,
      description: assignment.description,
      dueAt: assignment.due_at,
      updatedAt: assignment.updated_at,
      audience: assignment.audience,
      departmentId: assignment.department_id,
      targetIds,
      examId: assignment.config.exam_id ?? "",
      examName: examName.get(assignment.config.exam_id ?? "") ?? "Unknown exam",
      subjects: assignment.config.subject_ids.map((id) => ({
        id,
        // A subject deleted since the prescription was written: named as
        // such rather than dropped, because the config still draws on it.
        ...(subject.get(id) ?? {
          name: "Removed subject",
          specialty: "—",
          questionCount: 0,
        }),
      })),
      difficulty: assignment.config.difficulty,
      numQuestions: assignment.config.num_questions,
      mode: assignment.config.mode ?? "exam",
      durationMin:
        assignment.config.duration_sec !== undefined
          ? Math.round(assignment.config.duration_sec / 60)
          : null,
      targeted,
      completed,
      late,
      completedTutor,
      departmentName,
      started,
    })
  );
}

/**
 * One assignment, or null. `listAssignmentProgress` is already scoped to the
 * org, so an id from another org (or a soft-deleted one) simply misses —
 * which is the same answer as "doesn't exist", and the page 404s on it.
 */
export async function findAssignmentRow(
  session: OrgAdminSession,
  id: string
): Promise<AssignmentRow | null> {
  const rows = await loadAssignmentRows(session);
  return rows.find((row) => row.id === id) ?? null;
}
