"use client";

import { useActionState } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type { SubjectDetail as SubjectDetailData } from "@/lib/admin/taxonomy";
import {
  deleteSubject,
  reorder,
  renameSubject,
  type AdminState,
} from "@/app/admin/subjects/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormMessage } from "@/components/auth/form-parts";
import { AdminSubmit } from "@/components/admin/form-parts";
import { ConfirmSubmit } from "@/components/confirm-dialog";

/** Everything you can do to one subject, on its own page. */
export function SubjectDetail({ subject }: { subject: SubjectDetailData }) {
  return (
    <div className="space-y-6">
      <SubjectSettingsCard subject={subject} />
      <DangerZone subject={subject} />
    </div>
  );
}

function SubjectSettingsCard({ subject }: { subject: SubjectDetailData }) {
  const [renameState, renameAction] = useActionState<AdminState, FormData>(
    renameSubject,
    null
  );

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <h2 className="font-display text-lg">Details</h2>
        <FormMessage error={renameState?.error} success={renameState?.success} />

        <form action={renameAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={subject.id} />

          <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-xs">
            <Label htmlFor="subject-name">Name</Label>
            <Input
              id="subject-name"
              name="name"
              defaultValue={subject.name}
              required
              className="h-10 font-medium"
            />
          </div>

          <AdminSubmit variant="outline-muted">Save</AdminSubmit>
        </form>

        <p className="text-xs text-muted-foreground">
          Lives in {subject.examName} › {subject.specialtyName}. Renaming never
          moves it — subject names only have to be unique within a specialty.
        </p>
      </CardContent>
    </Card>
  );
}

function DangerZone({ subject }: { subject: SubjectDetailData }) {
  const [deleteState, deleteAction] = useActionState<AdminState, FormData>(
    deleteSubject,
    null
  );

  // Soft-deleted questions keep their FK, so they block the delete exactly
  // like live ones do. Count both or the button lies.
  const attached = subject.questionCount + subject.deletedCount;
  const blocked = attached > 0;

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-3">
        <h2 className="font-display text-lg">Delete this subject</h2>
        <p className="text-sm text-muted-foreground">
          {blocked
            ? `${subject.name} still has ${attached} question${
                attached === 1 ? "" : "s"
              } filed under it${
                subject.deletedCount > 0
                  ? ` (${subject.deletedCount} of them deleted — those are kept so past papers stay intact)`
                  : ""
              }. Move or delete them first.`
            : "This subject is empty, so deleting it loses nothing else."}
        </p>
        <FormMessage error={deleteState?.error} />
        <form action={deleteAction}>
          <input type="hidden" name="id" value={subject.id} />
          <ConfirmSubmit
            variant="destructive"
            size="sm"
            disabled={blocked}
            triggerLabel={`Delete ${subject.name}`}
            title={`Delete "${subject.name}"?`}
            confirmLabel="Delete subject"
            irreversible
            description={`This permanently deletes the subject and returns you to ${subject.specialtyName}.`}
          >
            <Trash2 data-icon="inline-start" />
            Delete subject
          </ConfirmSubmit>
        </form>
      </CardContent>
    </Card>
  );
}

/** Shared by the index cards and this page's own reorder controls. */
export function SubjectReorderButtons({
  id,
  isFirst,
  isLast,
}: {
  id: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [, action] = useActionState<AdminState, FormData>(reorder, null);

  return (
    <span className="flex items-center">
      <form action={action}>
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
