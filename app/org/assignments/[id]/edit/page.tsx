import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOrgAdmin } from "@/lib/orgs";
import {
  findAssignmentRow,
  loadAssignmentFormOptions,
} from "@/lib/org-assignments-view";
import { AssignmentForm } from "@/components/org/assignment-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Edit assignment" };

/**
 * Editing an assignment, on its own page like creating one. The form
 * carries the row's `updated_at` as an optimistic-concurrency token, so a
 * fresh page load is also a fresh token — two admins editing at once still
 * collide at the action, which is where that rule belongs.
 */
export default async function EditOrgAssignmentPage(
  props: PageProps<"/org/assignments/[id]/edit">
) {
  const session = await requireOrgAdmin();
  const { id } = await props.params;

  const [options, row] = await Promise.all([
    loadAssignmentFormOptions(session),
    // Scoped to the org, so another org's id (or a deleted one) 404s —
    // the same answer as "doesn't exist", so the page never confirms
    // foreign ids. The action re-checks regardless.
    findAssignmentRow(session, id),
  ]);
  if (!row) notFound();

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/org/assignments/${row.id}`}>
            <ArrowLeft data-icon="inline-start" />
            Back
          </Link>
        </Button>
        {/* h2: the org layout owns the page's h1 (the org name). */}
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          Edit “{row.title}”
        </h2>
      </div>

      <Card className="[--card-spacing:--spacing(6)]">
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Members already working on it keep the test they started. Changes
            apply to everyone who opens it from now on, and are noted in the
            audit log.
            {row.started > 0 &&
              " Someone has already started, so the test itself is locked — the title, instructions, due date and audience can still change."}
          </p>
          <AssignmentForm
            exams={options.exams}
            members={options.members}
            departments={options.departments}
            editing={row}
          />
        </CardContent>
      </Card>
    </div>
  );
}
