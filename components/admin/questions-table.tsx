"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Pencil } from "lucide-react";
import type { QuestionListRow } from "@/lib/admin/questions";
import {
  bulkSetDeleted,
  bulkSetPublished,
  setQuestionDeleted,
  togglePublish,
  type BulkState,
  type QuestionState,
} from "@/app/admin/questions/actions";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // The selection is always re-derived from the rows actually on screen. A
  // filter change or a page turn swaps `rows` while the Set survives, and
  // sending an id the admin can no longer see into a bulk delete is exactly
  // the surprise this avoids.
  const selectedIds = useMemo(
    () => rows.filter((r) => selected.has(r.id)).map((r) => r.id),
    [rows, selected]
  );

  const toggle = (id: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const clear = () => setSelected(new Set());
  const selectPage = (checked: boolean) =>
    setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set());

  const allOnPage = rows.length > 0 && selectedIds.length === rows.length;
  const headerChecked: boolean | "indeterminate" = allOnPage
    ? true
    : selectedIds.length > 0
      ? "indeterminate"
      : false;

  // One state for both bulk forms, and it lives HERE rather than in the bar:
  // a successful action clears the selection, which unmounts the bar, and a
  // report like "12 published, 3 skipped" would disappear before it was read.
  const [bulkState, bulkAction] = useActionState<BulkState, FormData>(
    async (prev, formData) => {
      const result =
        formData.get("op") === "publish"
          ? await bulkSetPublished(prev, formData)
          : await bulkSetDeleted(prev, formData);
      // Keep the selection on failure so the same batch can be retried.
      if (!result?.error) clear();
      return result;
    },
    null
  );

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
      <BulkResult state={bulkState} />

      {selectedIds.length > 0 && (
        <QuestionsBulkBar
          ids={selectedIds}
          rows={rows}
          action={bulkAction}
          onClear={clear}
        />
      )}

      {/* Below md the columns can't fit, and Publish/Delete would sit
          off-screen behind a horizontal scroll nobody discovers. Cards put
          every action in reach instead. */}
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <QuestionCard
              row={row}
              selected={selected.has(row.id)}
              onSelect={toggle}
            />
          </li>
        ))}
      </ul>

      <Card className="hidden [--card-spacing:--spacing(4)] md:block">
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={headerChecked}
                    onCheckedChange={(v) => selectPage(v === true)}
                    aria-label={
                      allOnPage
                        ? "Clear selection"
                        : "Select all questions on this page"
                    }
                  />
                </TableHead>
                <TableHead>Question</TableHead>
                <TableHead>Exam</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Options</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <QuestionRow
                  key={row.id}
                  row={row}
                  selected={selected.has(row.id)}
                  onSelect={toggle}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

/** Mobile presentation of a question row. */
function QuestionCard({
  row,
  selected,
  onSelect,
}: {
  row: QuestionListRow;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
}) {
  return (
    <Card className={cn("[--card-spacing:--spacing(4)]", row.deleted_at && "opacity-60")}>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-3">
          <SelectCheckbox row={row} selected={selected} onSelect={onSelect} />
          <Link
            href={`/admin/questions/${row.id}`}
            className="block font-medium hover:text-primary"
          >
            {row.stem}
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {row.examName && <span>{row.examName}</span>}
          <span>
            {row.subjectName} · {row.specialtyName}
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

/**
 * Row selection control. Deliberately React state rather than a form input:
 * the per-row action forms live inside the table, and a form wrapping the
 * table would nest them, which HTML does not allow.
 */
function SelectCheckbox({
  row,
  selected,
  onSelect,
}: {
  row: QuestionListRow;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
}) {
  return (
    <Checkbox
      checked={selected}
      onCheckedChange={(v) => onSelect(row.id, v === true)}
      // The stem is the only thing that tells two rows apart by ear.
      aria-label={`Select "${row.stem.slice(0, 60)}"`}
    />
  );
}

function QuestionRow({
  row,
  selected,
  onSelect,
}: {
  row: QuestionListRow;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
}) {
  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      className={cn(row.deleted_at && "opacity-60")}
    >
      <TableCell>
        <SelectCheckbox row={row} selected={selected} onSelect={onSelect} />
      </TableCell>

      <TableCell className="max-w-sm">
        <Link
          href={`/admin/questions/${row.id}`}
          className="line-clamp-2 font-medium hover:text-primary"
        >
          {row.stem}
        </Link>
      </TableCell>

      <TableCell className="whitespace-nowrap text-sm">
        {row.examName}
      </TableCell>

      <TableCell className="whitespace-nowrap text-sm">
        <span className="block">{row.subjectName}</span>
        <span className="block text-xs text-muted-foreground">
          {row.specialtyName}
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
 * Outcome of the last bulk action.
 *
 * Bulk publish takes what it can and reports the rest, so a partial success
 * has to name the questions it left behind — "3 skipped" with no way to reach
 * them is a dead end.
 */
function BulkResult({ state }: { state: BulkState }) {
  if (!state?.error && !state?.success) return null;

  return (
    <div className="mb-4 space-y-2">
      <FormMessage error={state.error} success={state.success} />

      {state.skipped && state.skipped.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-border px-3 py-2.5 text-sm">
          {state.skipped.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
              <Link
                href={`/admin/questions/${s.id}`}
                className="font-medium hover:text-primary"
              >
                {s.stem.length > 80 ? `${s.stem.slice(0, 80)}…` : s.stem}
              </Link>
              <span className="text-xs text-muted-foreground">{s.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Actions for the current selection.
 *
 * Its own forms, sitting outside the table: the per-row action forms are
 * already inside it, and nesting forms is invalid HTML. The selected ids
 * travel as hidden inputs, one action per click — Next dispatches Server
 * Actions one at a time, so twenty per-row submits would run in series.
 */
function QuestionsBulkBar({
  ids,
  rows,
  action,
  onClear,
}: {
  ids: string[];
  rows: QuestionListRow[];
  action: (formData: FormData) => void;
  onClear: () => void;
}) {
  const selectedRows = rows.filter((r) => ids.includes(r.id));
  // Each button is disabled when the server would have nothing to act on —
  // publish and delete only reach live rows, restore only deleted ones.
  const live = selectedRows.filter((r) => !r.deleted_at).length;
  const deleted = selectedRows.length - live;
  const usedInTests = selectedRows.reduce((n, r) => n + r.usageCount, 0);

  const hiddenIds = ids.map((id) => (
    <input key={id} type="hidden" name="ids" value={id} />
  ));

  return (
    // top-18 clears the sticky h-16 admin header; z-10 stays under its z-40.
    <div className="sticky top-18 z-10 mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm">
      <span className="text-sm font-medium tabular-nums">
        {ids.length} selected
      </span>

      <Button type="button" variant="ghost" size="xs" onClick={onClear}>
        Clear
      </Button>

      <div className="ml-auto flex flex-wrap items-center gap-1">
        <form action={action} className="flex items-center gap-1">
          {hiddenIds}
          <input type="hidden" name="op" value="publish" />
          {/* Two opposite submits in one form — the submitter's name/value is
              what tells the action which way to go. */}
          <AdminSubmit
            variant="ghost"
            size="xs"
            name="publish"
            value="true"
            disabled={live === 0}
          >
            Publish
          </AdminSubmit>
          <AdminSubmit
            variant="ghost"
            size="xs"
            name="publish"
            value="false"
            disabled={live === 0}
          >
            Unpublish
          </AdminSubmit>
        </form>

        <form action={action} className="flex items-center gap-1">
          {hiddenIds}
          <input type="hidden" name="op" value="delete" />
          <AdminSubmit
            variant="ghost"
            size="xs"
            name="restore"
            value="true"
            disabled={deleted === 0}
          >
            Restore
          </AdminSubmit>
          {/* No name/value: the confirm dialog's hidden submit carries none,
              so `restore` is absent and the action deletes. */}
          <ConfirmSubmit
            size="xs"
            disabled={live === 0}
            title={`Delete ${live} question${live === 1 ? "" : "s"}?`}
            confirmLabel={`Delete ${live}`}
            description={
              <>
                They stop appearing in new tests and leave the bank. This is a
                soft delete — you can restore them later, and{" "}
                {usedInTests === 0
                  ? "any papers students have already sat are"
                  : usedInTests === 1
                    ? "the paper already sat with one of them is"
                    : `the ${usedInTests} papers already sat with them are`}{" "}
                unaffected.
              </>
            }
          >
            Delete
          </ConfirmSubmit>
        </form>
      </div>
    </div>
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
