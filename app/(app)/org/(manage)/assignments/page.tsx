import type { Metadata } from "next";
import {
  listAssignmentProgress,
  listOrgMembers,
  requireOrgAdmin,
} from "@/lib/orgs";
import { listExamCatalogTree } from "@/lib/catalog";
import {
  AssignmentsManager,
  type AssignmentExamOption,
  type AssignmentRow,
  type MemberOption,
} from "@/components/org/assignments-manager";

export const metadata: Metadata = { title: "Organisation assignments" };

export default async function OrgAssignmentsPage() {
  const session = await requireOrgAdmin();

  // The catalogue read is RLS'd under the org-admin's session, so it already
  // holds exactly what their members can practise: the public catalogue plus
  // this org's own bank.
  const [tree, members, progress] = await Promise.all([
    listExamCatalogTree(),
    listOrgMembers(session.org.id),
    listAssignmentProgress(session.org.id),
  ]);

  const exams: AssignmentExamOption[] = tree
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
