"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { deleteAssignment } from "@/app/org/assignments/actions";
import type { OrgActionState } from "@/app/org/members/actions";
import {
  AssignmentForm,
  type AssignmentExamOption,
  type AssignmentRow,
  type DepartmentOption,
  type MemberOption,
} from "@/components/org/assignment-form";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Re-exported so the pages keep one import for the view-model types.
export type {
  AssignmentExamOption,
  AssignmentRow,
  DepartmentOption,
  MemberOption,
};

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Editing only. Creating has its own page (/org/assignments/new): the
 * form is long — exam, mode, difficulty, length, a subject table and an
 * audience — and a page gives it room, a URL an admin can return to, and
 * the ordinary back button. */
type DialogState = { kind: "edit"; id: string } | null;

export function AssignmentsManager({
  exams,
  members,
  departments,
  rows,
}: {
  exams: AssignmentExamOption[];
  members: MemberOption[];
  departments: DepartmentOption[];
  rows: AssignmentRow[];
}) {
  const [deleteState, deleteAction] = useActionState<OrgActionState, FormData>(
    deleteAssignment,
    null
  );
  const [dialog, setDialog] = useState<DialogState>(null);
  // Resolved from the live rows, so a stale id (row removed elsewhere while
  // the dialog was open) simply closes it rather than editing a ghost.
  const editing = dialog ? (rows.find((r) => r.id === dialog.id) ?? null) : null;
  const open = editing !== null;

  return (
    <div className="space-y-6">
      <Dialog open={open} onOpenChange={(next) => !next && setDialog(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {editing ? `Edit “${editing.title}”` : "Edit assignment"}
            </DialogTitle>
            <DialogDescription>
              Members already working on it keep the test they started.
              Changes apply to everyone who opens it from now on, and are
              noted in the audit log.
            </DialogDescription>
          </DialogHeader>
          {/* Keyed so switching rows, or reopening after a save (new
              updatedAt), remounts the form with fresh defaults. */}
          {editing && (
            <AssignmentForm
              key={`${editing.id}:${editing.updatedAt}`}
              exams={exams}
              members={members}
              departments={departments}
              editing={editing}
              onDone={() => setDialog(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Open assignments</CardTitle>
            <CardDescription>
              Prescribed tests with a due date. Edit changes the title,
              instructions, due date and audience; the test itself locks
              once anyone has started.
            </CardDescription>
          </div>
          <Button asChild>
            <Link href="/org/assignments/new">New assignment</Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <FormMessage error={deleteState?.error} success={deleteState?.success} />
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing assigned yet.
            </p>
          )}
          <ul className="space-y-3">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{row.title}</p>
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
                {row.audience === "department" &&
                row.departmentName === null ? (
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDialog({ kind: "edit", id: row.id })}
                >
                  Edit
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
    </div>
  );
}
