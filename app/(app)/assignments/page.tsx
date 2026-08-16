import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { assignmentsForMember, getOrgMembership } from "@/lib/orgs";
import {
  AssignmentList,
  type AssignmentListItem,
} from "@/components/org/assignment-list";

export const metadata: Metadata = { title: "Assignments" };

export default async function AssignmentsPage() {
  const user = await requireUser();

  const membership = await getOrgMembership(user.id);
  if (!membership) redirect("/dashboard");

  const assignments = await assignmentsForMember(
    membership.org.id,
    user.id,
    membership.membership
  );

  const items: AssignmentListItem[] = assignments.map((row) => ({
    id: row.assignment.id,
    title: row.assignment.title,
    description: row.assignment.description,
    dueAt: row.assignment.due_at,
    numQuestions: row.assignment.config.num_questions,
    mode: row.assignment.config.mode ?? "exam",
    durationMin:
      row.assignment.config.duration_sec !== undefined
        ? Math.round(row.assignment.config.duration_sec / 60)
        : null,
    status: row.status,
    latestTestId: row.latestTestId,
    latestScore: row.latestScore,
    latestTotal: row.latestTotal,
    completedMode: row.completedMode,
  }));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Assignments
        </h1>
        <p className="mt-1 text-muted-foreground">
          Set by {membership.org.name}. Retakes are allowed — your latest
          submitted score is the one that counts.
        </p>
      </header>
      <AssignmentList items={items} />
    </div>
  );
}
