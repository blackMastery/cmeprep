"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import type { ExamWithSpecialties } from "@/lib/admin/taxonomy";
import {
  createExam,
  createSpecialty,
  deleteExam,
  deleteSpecialty,
  renameExam,
  renameSpecialty,
  reorderExamLevel,
} from "@/app/admin/exams/actions";
import type { AdminState } from "@/app/admin/subjects/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FormMessage } from "@/components/auth/form-parts";
import { AdminSubmit } from "@/components/admin/form-parts";
import { ConfirmSubmit } from "@/components/confirm-dialog";

export function ExamManager({ exams }: { exams: ExamWithSpecialties[] }) {
  const [createState, createAction] = useActionState<AdminState, FormData>(
    createExam,
    null
  );

  return (
    <div className="space-y-6">
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="space-y-4">
          <h2 className="font-display text-lg">Add an exam</h2>
          <FormMessage error={createState?.error} success={createState?.success} />
          <form action={createAction} className="flex flex-wrap gap-2">
            <Input
              name="name"
              placeholder="e.g. USMLE Step 1"
              required
              className="h-10 max-w-xs flex-1"
            />
            <Input
              name="code"
              placeholder="Code (optional)"
              className="h-10 w-36"
            />
            <AdminSubmit>
              <Plus data-icon="inline-start" />
              Add exam
            </AdminSubmit>
          </form>
        </CardContent>
      </Card>

      {exams.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No exams yet. Add one above — specialties, subjects and topics all
            live under an exam.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-4">
          {exams.map((exam, index) => (
            <li key={exam.id}>
              <ExamCard
                exam={exam}
                isFirst={index === 0}
                isLast={index === exams.length - 1}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExamCard({
  exam,
  isFirst,
  isLast,
}: {
  exam: ExamWithSpecialties;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [renameState, renameAction] = useActionState<AdminState, FormData>(
    renameExam,
    null
  );
  const [deleteState, deleteAction] = useActionState<AdminState, FormData>(
    deleteExam,
    null
  );
  const [specialtyState, specialtyAction] = useActionState<AdminState, FormData>(
    createSpecialty,
    null
  );

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        {/* Name on its own row — same 375px reasoning as SubjectManager. */}
        <div className="space-y-3">
          <form action={renameAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={exam.id} />
            <Input
              name="name"
              defaultValue={exam.name}
              aria-label={`Rename ${exam.name}`}
              className="h-10 min-w-0 flex-1 font-medium sm:max-w-xs"
            />
            <Input
              name="code"
              defaultValue={exam.code ?? ""}
              placeholder="Code"
              aria-label={`Code for ${exam.name}`}
              className="h-10 w-24"
            />
            <AdminSubmit variant="outline-muted" size="sm">
              Save
            </AdminSubmit>
          </form>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {exam.specialties.length} specialt
              {exam.specialties.length === 1 ? "y" : "ies"}
            </Badge>

            <span className="ml-auto flex items-center gap-1">
              <ReorderButtons
                table="exams"
                id={exam.id}
                isFirst={isFirst}
                isLast={isLast}
              />

              <form action={deleteAction}>
                <input type="hidden" name="id" value={exam.id} />
                <ConfirmSubmit
                  variant="destructive"
                  size="icon-sm"
                  triggerLabel={`Delete ${exam.name}`}
                  title={`Delete "${exam.name}"?`}
                  confirmLabel="Delete exam"
                  irreversible
                  description="This permanently deletes the exam. Exams with specialties can't be deleted."
                >
                  <Trash2 />
                </ConfirmSubmit>
              </form>
            </span>
          </div>
        </div>

        <FormMessage error={renameState?.error} success={renameState?.success} />
        <FormMessage error={deleteState?.error} />

        <div className="space-y-2 border-t border-border pt-4">
          {exam.specialties.length === 0 ? (
            <p className="text-sm text-muted-foreground">No specialties yet.</p>
          ) : (
            <ul className="space-y-2">
              {exam.specialties.map((sp, i) => (
                <li key={sp.id}>
                  <SpecialtyRow
                    specialty={sp}
                    examName={exam.name}
                    isFirst={i === 0}
                    isLast={i === exam.specialties.length - 1}
                  />
                </li>
              ))}
            </ul>
          )}

          <FormMessage
            error={specialtyState?.error}
            success={specialtyState?.success}
          />
          <form action={specialtyAction} className="flex flex-wrap gap-2 pt-1">
            <input type="hidden" name="examId" value={exam.id} />
            <Input
              name="name"
              placeholder="Add a specialty…"
              required
              className="h-9 max-w-xs flex-1"
            />
            <AdminSubmit variant="outline-muted" size="sm">
              Add specialty
            </AdminSubmit>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

function SpecialtyRow({
  specialty,
  examName,
  isFirst,
  isLast,
}: {
  specialty: ExamWithSpecialties["specialties"][number];
  examName: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [renameState, renameAction] = useActionState<AdminState, FormData>(
    renameSpecialty,
    null
  );
  const [deleteState, deleteAction] = useActionState<AdminState, FormData>(
    deleteSpecialty,
    null
  );

  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="space-y-2">
        <form action={renameAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={specialty.id} />
          <Input
            name="name"
            defaultValue={specialty.name}
            aria-label={`Rename ${specialty.name}`}
            className="h-9 min-w-0 flex-1 text-sm sm:max-w-xs"
          />
          <AdminSubmit variant="ghost" size="xs">
            Save
          </AdminSubmit>
        </form>

        <div className="flex flex-wrap items-center gap-1.5">
          {specialty.subjectCount > 0 ? (
            <Button variant="ghost" size="xs" asChild>
              <Link href={`/admin/subjects?specialty=${specialty.id}`}>
                {specialty.subjectCount} subject
                {specialty.subjectCount === 1 ? "" : "s"} →
              </Link>
            </Button>
          ) : (
            <Button variant="ghost" size="xs" asChild>
              <Link
                href={`/admin/subjects?specialty=${specialty.id}`}
                className="text-muted-foreground"
              >
                empty — add subjects
              </Link>
            </Button>
          )}

          <span className="ml-auto flex items-center gap-1">
            <ReorderButtons
              table="specialties"
              id={specialty.id}
              isFirst={isFirst}
              isLast={isLast}
            />

            <form action={deleteAction}>
              <input type="hidden" name="id" value={specialty.id} />
              <ConfirmSubmit
                size="icon-xs"
                triggerLabel={`Delete ${specialty.name} from ${examName}`}
                title={`Delete "${specialty.name}"?`}
                confirmLabel="Delete specialty"
                irreversible
                description={`This permanently deletes the specialty from ${examName}. Specialties with subjects can't be deleted.`}
              >
                <Trash2 />
              </ConfirmSubmit>
            </form>
          </span>
        </div>
      </div>

      <FormMessage error={renameState?.error} />
      <FormMessage error={deleteState?.error} />
    </div>
  );
}

function ReorderButtons({
  table,
  id,
  isFirst,
  isLast,
}: {
  table: "exams" | "specialties";
  id: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [, action] = useActionState<AdminState, FormData>(reorderExamLevel, null);

  return (
    <span className="flex items-center">
      <form action={action}>
        <input type="hidden" name="table" value={table} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="direction" value="up" />
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          disabled={isFirst}
          aria-label="Move up"
        >
          <ChevronUp />
        </Button>
      </form>
      <form action={action}>
        <input type="hidden" name="table" value={table} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="direction" value="down" />
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          disabled={isLast}
          aria-label="Move down"
        >
          <ChevronDown />
        </Button>
      </form>
    </span>
  );
}
