"use client";

import { useActionState } from "react";
import Link from "next/link";
import { FileUp, Plus, Trash2 } from "lucide-react";
import {
  createOrgSpecialty,
  createOrgSubject,
  deleteOrgExam,
  deleteOrgSpecialty,
  deleteOrgSubject,
  renameOrgExam,
  renameOrgSpecialty,
  renameOrgSubject,
} from "@/app/(app)/org/(manage)/content/actions";
import type { OrgActionState } from "@/app/(app)/org/(manage)/members/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FormMessage } from "@/components/auth/form-parts";
import { AdminSubmit } from "@/components/admin/form-parts";
import { ConfirmSubmit } from "@/components/confirm-dialog";

export type OrgExamDetailData = {
  id: string;
  name: string;
  specialties: {
    id: string;
    name: string;
    subjects: {
      id: string;
      name: string;
      questionCount: number;
      deletedCount: number;
    }[];
  }[];
};

/**
 * Everything you can do to one org exam, on its own page — the org twin of
 * components/admin/exam-detail.tsx, minus storefront concerns (no code, no
 * availability toggle, no subscription delete-block: org exams are never
 * sold). Subjects are managed inline here rather than on a separate page.
 */
export function OrgExamDetail({ exam }: { exam: OrgExamDetailData }) {
  const [specialtyState, specialtyAction] = useActionState<
    OrgActionState,
    FormData
  >(createOrgSpecialty, null);

  return (
    <div className="space-y-6">
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg">Import questions</h2>
            <p className="text-xs text-muted-foreground">
              Upload an Excel sheet — every row files under {exam.name}.
            </p>
          </div>
          <Button asChild>
            <Link href={`/org/content/import/${exam.id}`}>
              <FileUp data-icon="inline-start" />
              Import questions
            </Link>
          </Button>
        </CardContent>
      </Card>

      <NameCard exam={exam} />

      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="space-y-4">
          <div>
            <h2 className="font-display text-lg">Specialties &amp; subjects</h2>
            <p className="text-xs text-muted-foreground">
              Questions file under a subject; subjects live inside a
              specialty. Nothing with content below it can be deleted.
            </p>
          </div>

          {exam.specialties.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              No specialties yet. Add the first one below.
            </p>
          ) : (
            <ul className="space-y-3">
              {exam.specialties.map((sp) => (
                <li key={sp.id}>
                  <SpecialtyRow specialty={sp} examName={exam.name} />
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-border pt-4">
            <FormMessage
              error={specialtyState?.error}
              success={specialtyState?.success}
            />
            <form action={specialtyAction} className="flex flex-wrap gap-2 pt-1">
              <input type="hidden" name="examId" value={exam.id} />
              <Input
                name="name"
                placeholder="Add a specialty…"
                aria-label={`Add a specialty to ${exam.name}`}
                required
                className="h-9 max-w-xs flex-1"
              />
              <AdminSubmit variant="outline" size="sm">
                <Plus data-icon="inline-start" />
                Add specialty
              </AdminSubmit>
            </form>
          </div>
        </CardContent>
      </Card>

      <DangerZone exam={exam} />
    </div>
  );
}

function NameCard({ exam }: { exam: OrgExamDetailData }) {
  const [renameState, renameAction] = useActionState<OrgActionState, FormData>(
    renameOrgExam,
    null
  );

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <h2 className="font-display text-lg">Details</h2>
        <FormMessage error={renameState?.error} success={renameState?.success} />
        <form action={renameAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="examId" value={exam.id} />
          <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-xs">
            <Label htmlFor="org-exam-name">Name</Label>
            <Input
              id="org-exam-name"
              name="name"
              defaultValue={exam.name}
              required
              className="h-10 font-medium"
            />
          </div>
          <AdminSubmit variant="outline">Save</AdminSubmit>
        </form>
      </CardContent>
    </Card>
  );
}

function SpecialtyRow({
  specialty,
  examName,
}: {
  specialty: OrgExamDetailData["specialties"][number];
  examName: string;
}) {
  const [renameState, renameAction] = useActionState<OrgActionState, FormData>(
    renameOrgSpecialty,
    null
  );
  const [deleteState, deleteAction] = useActionState<OrgActionState, FormData>(
    deleteOrgSpecialty,
    null
  );
  const [subjectState, subjectAction] = useActionState<OrgActionState, FormData>(
    createOrgSubject,
    null
  );

  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <form action={renameAction} className="flex min-w-0 flex-1 items-center gap-2">
          <input type="hidden" name="specialtyId" value={specialty.id} />
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

        <form action={deleteAction}>
          <input type="hidden" name="specialtyId" value={specialty.id} />
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
      </div>
      <FormMessage error={renameState?.error} />
      <FormMessage error={deleteState?.error} />

      {/* Subjects, inline — the org surface has no separate subjects page. */}
      <ul className="mt-2 space-y-1.5 border-l border-border pl-3">
        {specialty.subjects.map((subject) => (
          <SubjectRow
            key={subject.id}
            subject={subject}
            specialtyName={specialty.name}
          />
        ))}
        <li className="pt-1">
          <FormMessage error={subjectState?.error} />
          <form action={subjectAction} className="flex items-center gap-2">
            <input type="hidden" name="specialtyId" value={specialty.id} />
            <Input
              name="name"
              placeholder="Add a subject…"
              aria-label={`Add a subject to ${specialty.name}`}
              required
              className="h-8 max-w-56 text-sm"
            />
            <AdminSubmit variant="ghost" size="xs">
              <Plus data-icon="inline-start" />
              Add
            </AdminSubmit>
          </form>
        </li>
      </ul>
    </div>
  );
}

function SubjectRow({
  subject,
  specialtyName,
}: {
  subject: OrgExamDetailData["specialties"][number]["subjects"][number];
  specialtyName: string;
}) {
  const [renameState, renameAction] = useActionState<OrgActionState, FormData>(
    renameOrgSubject,
    null
  );
  const [deleteState, deleteAction] = useActionState<OrgActionState, FormData>(
    deleteOrgSubject,
    null
  );

  // Soft-deleted questions still block the delete (their FK survives).
  const blocked = subject.questionCount + subject.deletedCount > 0;

  return (
    <li className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <form action={renameAction} className="flex min-w-0 flex-1 items-center gap-2">
          <input type="hidden" name="subjectId" value={subject.id} />
          <Input
            name="name"
            defaultValue={subject.name}
            aria-label={`Rename ${subject.name}`}
            className="h-8 min-w-0 flex-1 text-sm sm:max-w-56"
          />
          <AdminSubmit variant="ghost" size="xs">
            Save
          </AdminSubmit>
        </form>

        <Badge variant="secondary" asChild>
          <Link href={`/org/content/questions?subject=${subject.id}`}>
            {subject.questionCount} question
            {subject.questionCount === 1 ? "" : "s"} →
          </Link>
        </Badge>

        <form action={deleteAction}>
          <input type="hidden" name="subjectId" value={subject.id} />
          <ConfirmSubmit
            size="icon-xs"
            disabled={blocked}
            triggerLabel={`Delete ${subject.name} from ${specialtyName}`}
            title={`Delete "${subject.name}"?`}
            confirmLabel="Delete subject"
            irreversible
            description="Only subjects with no questions (deleted ones included) can be removed."
          >
            <Trash2 />
          </ConfirmSubmit>
        </form>
      </div>
      <FormMessage error={renameState?.error} />
      <FormMessage error={deleteState?.error} />
    </li>
  );
}

function DangerZone({ exam }: { exam: OrgExamDetailData }) {
  const [deleteState, deleteAction] = useActionState<OrgActionState, FormData>(
    deleteOrgExam,
    null
  );
  const blocked = exam.specialties.length > 0;

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-3">
        <h2 className="font-display text-lg">Delete this exam</h2>
        <p className="text-sm text-muted-foreground">
          {blocked
            ? `${exam.name} still has ${exam.specialties.length} specialt${
                exam.specialties.length === 1 ? "y" : "ies"
              }. Delete them first.`
            : "This exam holds nothing, so deleting it loses nothing else."}
        </p>
        <FormMessage error={deleteState?.error} />
        <form action={deleteAction}>
          <input type="hidden" name="examId" value={exam.id} />
          <ConfirmSubmit
            variant="destructive"
            size="sm"
            disabled={blocked}
            triggerLabel={`Delete ${exam.name}`}
            title={`Delete "${exam.name}"?`}
            confirmLabel="Delete exam"
            irreversible
            description="This permanently deletes the exam from your organisation's bank."
          >
            <Trash2 data-icon="inline-start" />
            Delete exam
          </ConfirmSubmit>
        </form>
      </CardContent>
    </Card>
  );
}
