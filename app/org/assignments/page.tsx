import type { Metadata } from "next";
import {
  listAssignmentProgress,
  requireOrgAdmin,
} from "@/lib/orgs";
import { listExamCatalogTree } from "@/lib/catalog";
import { loadAssignmentFormOptions } from "@/lib/org-assignment-options";
import {
  AssignmentsManager,
  type AssignmentRow,
} from "@/components/org/assignments-manager";
import { FlashToast } from "@/components/flash-toast";

export const metadata: Metadata = { title: "Assignments" };

export default async function OrgAssignmentsPage(
  props: PageProps<"/org/assignments">
) {
  const session = await requireOrgAdmin();
  const sp = await props.searchParams;

  const [options, tree, progress] = await Promise.all([
    loadAssignmentFormOptions(session),
    listExamCatalogTree(),
    listAssignmentProgress(session.org.id),
  ]);

  // Names for the locked-config summary come from the full tree, not the
  // entitlement-filtered `exams`: a lapsed plan must not turn a locked
  // assignment's exam into "Unknown" on the edit form.
  const examName = new Map(tree.map((exam) => [exam.id, exam.name]));
  const subjectName = new Map(
    tree.flatMap((exam) =>
      exam.specialties.flatMap((sp2) =>
        sp2.subjects.map((s) => [s.id, `${sp2.name} · ${s.name}`] as const)
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
    <>
      {/* The create page redirects here on success; this is where the
          confirmation surfaces, matching the toast an edit already gets. */}
      {sp.created !== undefined && (
        <FlashToast message="Assignment created." />
      )}
      <AssignmentsManager
        exams={options.exams}
        members={options.members}
        departments={options.departments}
        rows={rows}
      />
    </>
  );
}
