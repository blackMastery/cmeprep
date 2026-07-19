"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertTriangle, Pencil } from "lucide-react";
import type { QuestionListRow } from "@/lib/admin/questions";
import {
  setQuestionDeleted,
  togglePublish,
  type QuestionState,
} from "@/app/admin/questions/actions";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormMessage } from "@/components/auth/form-parts";
import { AdminSubmit } from "@/components/admin/form-parts";
import { ConfirmSubmit } from "@/components/confirm-dialog";

const TYPE_LABEL: Record<string, string> = {
  mcq_single: "Single",
  mcq_multi: "Multi",
  image_based: "Image",
};

export function QuestionsTable({ rows }: { rows: QuestionListRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="font-display text-lg">No questions match</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try widening the filters, or add a new question.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Below md the six columns can't fit, and Publish/Delete would sit
          off-screen behind a horizontal scroll nobody discovers. Cards put
          every action in reach instead. */}
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <QuestionCard row={row} />
          </li>
        ))}
      </ul>

      <Card className="hidden [--card-spacing:--spacing(4)] md:block">
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Question</TableHead>
                <TableHead>Topic</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Options</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <QuestionRow key={row.id} row={row} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

/** Mobile presentation of a question row. */
function QuestionCard({ row }: { row: QuestionListRow }) {
  return (
    <Card className={cn("[--card-spacing:--spacing(4)]", row.deleted_at && "opacity-60")}>
      <CardContent className="space-y-3">
        <Link
          href={`/admin/questions/${row.id}`}
          className="block font-medium hover:text-primary"
        >
          {row.stem}
        </Link>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {row.topicName} · {row.subjectName}
          </span>
          <span className="capitalize">
            {TYPE_LABEL[row.type] ?? row.type} · {row.difficulty}
          </span>
          <OptionCount row={row} />
          {row.usageCount > 0 && <span>used in {row.usageCount}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <StatusBadge row={row} />
          <span className="ml-auto flex items-center gap-1">
            <QuestionActions row={row} />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/** Correct/total with a warning when the answer key can't be valid. */
function OptionCount({ row }: { row: QuestionListRow }) {
  const keyLooksWrong =
    row.type === "mcq_multi"
      ? row.correctCount < 2
      : row.correctCount !== 1;

  return (
    <span className={cn("tabular-nums", keyLooksWrong && "text-destructive")}>
      {row.correctCount}/{row.optionCount}
      {keyLooksWrong && (
        <AlertTriangle
          className="ml-1 inline size-3.5"
          aria-label="Answer key looks wrong"
        />
      )}
    </span>
  );
}

function StatusBadge({ row }: { row: QuestionListRow }) {
  if (row.deleted_at) return <Badge variant="outline">Deleted</Badge>;
  if (row.is_published) return <Badge>Published</Badge>;
  return <Badge variant="secondary">Draft</Badge>;
}

function QuestionRow({ row }: { row: QuestionListRow }) {
  return (
    <TableRow className={cn(row.deleted_at && "opacity-60")}>
      <TableCell className="max-w-sm">
        <Link
          href={`/admin/questions/${row.id}`}
          className="line-clamp-2 font-medium hover:text-primary"
        >
          {row.stem}
        </Link>
      </TableCell>

      <TableCell className="whitespace-nowrap text-sm">
        <span className="block">{row.topicName}</span>
        <span className="block text-xs text-muted-foreground">
          {row.subjectName}
        </span>
      </TableCell>

      <TableCell className="whitespace-nowrap text-sm">
        {TYPE_LABEL[row.type] ?? row.type}
        <span className="block text-xs text-muted-foreground capitalize">
          {row.difficulty}
        </span>
      </TableCell>

      <TableCell className="whitespace-nowrap text-sm">
        <OptionCount row={row} />
        {row.usageCount > 0 && (
          <span className="block text-xs text-muted-foreground">
            used in {row.usageCount}
          </span>
        )}
      </TableCell>

      <TableCell>
        <StatusBadge row={row} />
      </TableCell>

      <TableCell>
        <div className="flex items-center justify-end gap-1">
          <QuestionActions row={row} />
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * Edit / publish / delete controls, shared by the table row and the mobile
 * card so the two presentations can never drift apart.
 */
function QuestionActions({ row }: { row: QuestionListRow }) {
  const [publishState, publishAction] = useActionState<QuestionState, FormData>(
    togglePublish,
    null
  );
  const [deleteState, deleteAction] = useActionState<QuestionState, FormData>(
    setQuestionDeleted,
    null
  );

  return (
    <>
      {(publishState?.error || deleteState?.error) && (
        <div className="w-full">
          <FormMessage error={publishState?.error ?? deleteState?.error} />
        </div>
      )}

          <Button variant="ghost" size="icon-sm" asChild>
            <Link href={`/admin/questions/${row.id}`} aria-label="Edit question">
              <Pencil />
            </Link>
          </Button>

          {!row.deleted_at && (
            <form action={publishAction}>
              <input type="hidden" name="id" value={row.id} />
              <input
                type="hidden"
                name="publish"
                value={row.is_published ? "false" : "true"}
              />
              <AdminSubmit variant="ghost" size="xs">
                {row.is_published ? "Unpublish" : "Publish"}
              </AdminSubmit>
            </form>
          )}

          <form action={deleteAction}>
            <input type="hidden" name="id" value={row.id} />
            <input
              type="hidden"
              name="restore"
              value={row.deleted_at ? "true" : "false"}
            />
            {row.deleted_at ? (
              // Restoring isn't destructive — no gate needed.
              <AdminSubmit variant="ghost" size="xs">
                Restore
              </AdminSubmit>
            ) : (
              <ConfirmSubmit
                size="xs"
                title="Delete this question?"
                confirmLabel="Delete question"
                description={
                  <>
                    It stops appearing in new tests and leaves the bank. This is
                    a soft delete — you can restore it later, and{" "}
                    {row.usageCount === 1
                      ? "the paper already sat with it is"
                      : row.usageCount > 1
                        ? `the ${row.usageCount} papers already sat with it are`
                        : "any papers students have already sat are"}{" "}
                    unaffected.
                  </>
                }
              >
                Delete
              </ConfirmSubmit>
            )}
          </form>
    </>
  );
}
