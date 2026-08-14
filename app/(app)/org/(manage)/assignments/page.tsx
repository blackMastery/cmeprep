import type { Metadata } from "next";
import {
  listAssignmentProgress,
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
  const [tree, members, progress, orgSubs] = await Promise.all([
    listExamCatalogTree(),
    listOrgMembers(session.org.id),
    listAssignmentProgress(session.org.id),
    listOrgSubscriptions(session.org.id),
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

  const rows: AssignmentRow[] = progress.map(
    ({ assignment, targeted, completed, late }) => ({
      id: assignment.id,
      title: assignment.title,
      dueAt: assignment.due_at,
      audience: assignment.audience,
      numQuestions: assignment.config.num_questions,
      durationMin: Math.round(assignment.config.duration_sec / 60),
      targeted,
      completed,
      late,
    })
  );

  return (
    <AssignmentsManager exams={exams} members={memberOptions} rows={rows} />
  );
}
