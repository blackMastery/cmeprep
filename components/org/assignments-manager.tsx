"use client";

import Link from "next/link";
import { useActionState } from "react";
import { deleteAssignment } from "@/app/org/assignments/actions";
import type { OrgActionState } from "@/app/org/members/actions";
import type { AssignmentRow } from "@/components/org/assignment-form";
import { FormMessage } from "@/components/auth/form-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type { AssignmentRow };

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * The assignments list. A client component only for the delete action's
 * state — creating, previewing and editing each have their own route
 * (/new, /[id], /[id]/edit), so no form or dialog lives here any more.
 */
export function AssignmentsManager({ rows }: { rows: AssignmentRow[] }) {
  const [deleteState, deleteAction] = useActionState<OrgActionState, FormData>(
    deleteAssignment,
    null
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>Open assignments</CardTitle>
          <CardDescription>
            Prescribed tests with a due date. Open one to see what members
            get and how it is going; the test itself locks once anyone has
            started.
          </CardDescription>
        </div>
        <Button asChild>
          <Link href="/org/assignments/new">New assignment</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <FormMessage error={deleteState?.error} success={deleteState?.success} />
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing assigned yet.</p>
        )}
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border px-4 py-3"
            >
              {/* The title is the link: the preview page is where an admin
                  checks what they set before members meet it. */}
              <div className="min-w-0 flex-1">
                <Link
                  href={`/org/assignments/${row.id}`}
                  className="font-medium hover:underline"
                >
                  {row.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  Due {shortDate(row.dueAt)} · {row.numQuestions} questions ·{" "}
                  {row.mode === "tutor" ? "Tutor" : `${row.durationMin} min`} ·{" "}
                  {row.audience === "all"
                    ? "everyone"
                    : row.audience === "department"
                      ? (row.departmentName ??
                        `${row.targeted} member${row.targeted === 1 ? "" : "s"}`)
                      : `${row.targeted} member${row.targeted === 1 ? "" : "s"}`}
                </p>
              </div>
              {row.audience === "department" && row.departmentName === null ? (
                // The department was hard-deleted: the assignment reaches
                // nobody, and a 0/0 count would only obscure that.
                <Badge variant="destructive">Department deleted</Badge>
              ) : (
                <Badge
                  variant={
                    row.completed >= row.targeted && row.targeted > 0
                      ? "default"
                      : "secondary"
                  }
                >
                  {row.completed}/{row.targeted} done
                  {row.late > 0 ? ` · ${row.late} late` : ""}
                  {/* Overrides count but are labeled: a tutor completion of
                      an exam assignment is real work, differently done. */}
                  {row.completedTutor > 0 && row.mode === "exam"
                    ? ` · ${row.completedTutor} in tutor mode`
                    : ""}
                </Badge>
              )}
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/org/assignments/${row.id}`}>Preview</Link>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/org/assignments/${row.id}/edit`}>Edit</Link>
              </Button>
              <form
                action={deleteAction}
                onSubmit={(event) => {
                  if (!window.confirm(`Remove "${row.title}"?`)) {
                    event.preventDefault();
                  }
                }}
              >
                <input type="hidden" name="assignmentId" value={row.id} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                >
                  Remove
                </Button>
              </form>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
