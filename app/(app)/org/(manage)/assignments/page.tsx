import type { Metadata } from "next";
import {
  listAssignmentProgress,
  listOrgDepartments,
  listOrgMembers,
  listOrgSubscriptions,
  requireOrgAdmin,
} from "@/lib/orgs";
import { listExamCatalogTree } from "@/lib/catalog";
import { orgAccessOf } from "@/lib/entitlements-core";
import {
  AssignmentsManager,
  type AssignmentExamOption,
  type AssignmentRow,
  type MemberOption,
} from "@/components/org/assignments-manager";

export const metadata: Metadata = { title: "Organisation assignments" };

export default async function OrgAssignmentsPage() {
  const session = await requireOrgAdmin();

  // RLS narrows the catalogue to public + own bank; the entitlement filter
  // below narrows further to what the org's per-exam plan actually covers —
  // offering an unentitled exam would only fail at the action.
  const [tree, members, progress, orgSubs, departments] = await Promise.all([
    listExamCatalogTree(),
    listOrgMembers(session.org.id),
    listAssignmentProgress(session.org.id),
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
      subjects: exam.specialties.flatMap((sp) =>
        sp.subjects
          .filter((s) => s.questionCount > 0)
          .map((s) => ({
            id: s.id,
            name: `${sp.name} · ${s.name}`,
            questionCount: s.questionCount,
          }))
      ),
    }))
    .filter((exam) => exam.subjects.length > 0);

  const memberOptions: MemberOption[] = members.map((row) => ({
    userId: row.member.user_id,
    label: row.profile?.full_name ?? row.email ?? row.member.user_id,
  }));

  // Names for the locked-config summary come from the full tree, not the
  // entitlement-filtered `exams`: a lapsed plan must not turn a locked
  // assignment's exam into "Unknown" on the edit form.
  const examName = new Map(tree.map((exam) => [exam.id, exam.name]));
  const subjectName = new Map(
    tree.flatMap((exam) =>
      exam.specialties.flatMap((sp) =>
        sp.subjects.map((s) => [s.id, `${sp.name} · ${s.name}`] as const)
      )
    )
  );

  const rows: AssignmentRow[] = progress.map(
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
      subjectIds: assignment.config.subject_ids,
      subjectNames: assignment.config.subject_ids.map(
        (id) => subjectName.get(id) ?? "Removed subject"
      ),
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

  return (
    <AssignmentsManager
      exams={exams}
      members={memberOptions}
      departments={departments.map((d) => ({ id: d.id, name: d.name }))}
      rows={rows}
    />
  );
}
