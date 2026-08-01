"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Eye, EyeOff, FileUp, Plus, Trash2 } from "lucide-react";
import type { ExamWithSpecialties } from "@/lib/admin/taxonomy";
import {
  createSpecialty,
  deleteExam,
  deleteSpecialty,
  renameExam,
  renameSpecialty,
  reorderExamLevel,
  setExamAvailability,
} from "@/app/admin/exams/actions";
import type { AdminState } from "@/app/admin/subjects/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FormMessage } from "@/components/auth/form-parts";
import { AdminSubmit } from "@/components/admin/form-parts";
import { ConfirmSubmit } from "@/components/confirm-dialog";

/** Everything you can do to one exam, on its own page. */
export function ExamDetail({ exam }: { exam: ExamWithSpecialties }) {
  const [specialtyState, specialtyAction] = useActionState<AdminState, FormData>(
    createSpecialty,
    null
  );

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
            <Link href={`/admin/exams/${exam.id}/import`}>
              <FileUp data-icon="inline-start" />
              Import questions
            </Link>
          </Button>
        </CardContent>
      </Card>

      <ExamSettingsCard exam={exam} />

      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="space-y-4">
          <div>
            <h2 className="font-display text-lg">Specialties</h2>
            <p className="text-xs text-muted-foreground">
              Subjects live inside a specialty. A specialty with subjects
              can&apos;t be deleted.
            </p>
          </div>

          {exam.specialties.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              No specialties yet. Add the first one below.
            </p>
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
              <AdminSubmit variant="outline-muted" size="sm">
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

function ExamSettingsCard({ exam }: { exam: ExamWithSpecialties }) {
  const [renameState, renameAction] = useActionState<AdminState, FormData>(
    renameExam,
    null
  );

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <h2 className="font-display text-lg">Details</h2>
        <FormMessage error={renameState?.error} success={renameState?.success} />

        {/* name and code post together — renameExam validates both as one
            examSchema, so splitting them into two forms would blank the
            other field. */}
        <form action={renameAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={exam.id} />

          <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-xs">
            <Label htmlFor="exam-name">Name</Label>
            <Input
              id="exam-name"
              name="name"
              defaultValue={exam.name}
              required
              className="h-10 font-medium"
            />
          </div>

          <div className="w-28 space-y-1.5">
            <Label htmlFor="exam-code">Code</Label>
            <Input
              id="exam-code"
              name="code"
              defaultValue={exam.code ?? ""}
              placeholder="Optional"
              className="h-10"
            />
          </div>

          <AdminSubmit variant="outline-muted">Save</AdminSubmit>
        </form>

        <AvailabilityRow exam={exam} />
      </CardContent>
    </Card>
  );
}

/**
 * Separate form from the rename above: availability posts a single boolean
 * and must not carry — or clobber — the name/code pair.
 */
function AvailabilityRow({ exam }: { exam: ExamWithSpecialties }) {
  const [state, action] = useActionState<AdminState, FormData>(
    setExamAvailability,
    null
  );

  return (
    <div className="border-t border-border pt-4">
      <FormMessage error={state?.error} success={state?.success} />

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            Availability
            <Badge variant={exam.is_active ? "outline" : "secondary"}>
              {exam.is_active ? "Offered at checkout" : "Not offered"}
            </Badge>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {exam.is_active
              ? "Students can buy access to this exam."
              : "Hidden from checkout. Anyone who already bought it keeps full access until their subscription ends."}
          </p>
        </div>

        <form action={action}>
          <input type="hidden" name="id" value={exam.id} />
          <input
            type="hidden"
            name="isActive"
            value={exam.is_active ? "false" : "true"}
          />
          <AdminSubmit variant="outline-muted" size="sm">
            {exam.is_active ? (
              <>
                <EyeOff data-icon="inline-start" />
                Withdraw from sale
              </>
            ) : (
              <>
                <Eye data-icon="inline-start" />
                Offer at checkout
              </>
            )}
          </AdminSubmit>
        </form>
      </div>
    </div>
  );
}

function DangerZone({ exam }: { exam: ExamWithSpecialties }) {
  const [deleteState, deleteAction] = useActionState<AdminState, FormData>(
    deleteExam,
    null
  );

  const specialtyBlock = exam.specialties.length > 0;
  const subscriptionBlock = exam.subscriptionCount > 0;
  const blocked = specialtyBlock || subscriptionBlock;

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-3">
        <h2 className="font-display text-lg">Delete this exam</h2>
        <p className="text-sm text-muted-foreground">
          {specialtyBlock
            ? `${exam.name} still has ${exam.specialties.length} specialt${
                exam.specialties.length === 1 ? "y" : "ies"
              }. Delete or move them first.`
            : subscriptionBlock
              ? `${exam.name} still has ${exam.subscriptionCount} subscription${
                  exam.subscriptionCount === 1 ? "" : "s"
                } tied to it. Withdraw it from checkout instead — sold exams can't be deleted.`
              : "This exam holds no specialties or subscriptions, so deleting it loses nothing else."}
        </p>
        <FormMessage error={deleteState?.error} />
        <form action={deleteAction}>
          <input type="hidden" name="id" value={exam.id} />
          <ConfirmSubmit
            variant="destructive"
            size="sm"
            disabled={blocked}
            triggerLabel={`Delete ${exam.name}`}
            title={`Delete "${exam.name}"?`}
            confirmLabel="Delete exam"
            irreversible
            description="This permanently deletes the exam and returns you to the exam list."
          >
            <Trash2 data-icon="inline-start" />
            Delete exam
          </ConfirmSubmit>
        </form>
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
            <>
              <Button variant="ghost" size="xs" asChild>
                <Link href={`/admin/subjects?specialty=${specialty.id}`}>
                  {specialty.subjectCount} subject
                  {specialty.subjectCount === 1 ? "" : "s"} →
                </Link>
              </Button>
              <Badge variant="secondary">
                {specialty.questionCount} question
                {specialty.questionCount === 1 ? "" : "s"}
              </Badge>
            </>
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
            <ExamReorderButtons
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

/** Shared by the index cards (exams) and this page's specialty rows. */
export function ExamReorderButtons({
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
