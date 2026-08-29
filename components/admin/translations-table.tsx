"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { TranslationListRow } from "@/lib/admin/translations";
import {
  deleteTranslationAction,
  regenerateTranslationAction,
  type TranslationState,
} from "@/app/admin/translations/actions";
import { languageByCode } from "@/lib/translation-core";
import { Badge } from "@/components/ui/badge";
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
import { ConfirmSubmit } from "@/components/confirm-dialog";
import { TranslationDetailDialog } from "@/components/admin/translation-detail-dialog";

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function TranslationsTable({
  rows,
  filtered,
}: {
  rows: TranslationListRow[];
  /** Any filter active — decides the empty-state copy. */
  filtered: boolean;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="font-display text-lg">
            {filtered ? "No translations match" : "Nothing translated yet"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {filtered
              ? "Try widening the filters."
              : "Translations appear here the first time a student translates a question."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Below md the columns can't fit; cards keep every action in reach. */}
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={`${row.questionId}-${row.language}`}>
            <Card className="[--card-spacing:--spacing(4)]">
              <CardContent className="space-y-3">
                <Link
                  href={`/admin/questions/${row.questionId}`}
                  className="line-clamp-2 block font-medium hover:text-primary"
                >
                  {row.original.stem}
                </Link>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{languageByCode(row.language)?.name ?? row.language}</span>
                  <span>{dateFmt.format(new Date(row.updatedAt))}</span>
                  <span>{row.model}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <StatusBadge row={row} />
                  <span className="ml-auto flex items-center gap-1">
                    <RowActions row={row} />
                  </span>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <Card className="hidden [--card-spacing:--spacing(4)] md:block">
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Question</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.questionId}-${row.language}`}>
                  <TableCell className="max-w-sm">
                    <Link
                      href={`/admin/questions/${row.questionId}`}
                      className="line-clamp-2 font-medium hover:text-primary"
                    >
                      {row.original.stem}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {row.examName}
                      {row.examName && row.subjectName ? " · " : ""}
                      {row.subjectName}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {languageByCode(row.language)?.name ?? row.language}
                    <span className="block text-xs text-muted-foreground">
                      {row.language}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm tabular-nums">
                    {dateFmt.format(new Date(row.updatedAt))}
                  </TableCell>
                  <TableCell>
                    <StatusBadge row={row} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {row.model}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <RowActions row={row} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

function StatusBadge({ row }: { row: TranslationListRow }) {
  if (row.questionDeleted) return <Badge variant="outline">Question deleted</Badge>;
  if (row.stale) {
    // Sun = caution: the English moved on and this row will never be served
    // again until it is regenerated (or a student's click regenerates it).
    return (
      <Badge className="border-sun bg-sun/15 text-foreground">
        Stale — English edited since
      </Badge>
    );
  }
  return <Badge variant="outline">Current</Badge>;
}

/** View / Regenerate / Delete, shared by the row and the mobile card. */
function RowActions({ row }: { row: TranslationListRow }) {
  const [regenState, regenAction] = useActionState<TranslationState, FormData>(
    regenerateTranslationAction,
    null
  );
  const [deleteState, deleteAction] = useActionState<TranslationState, FormData>(
    deleteTranslationAction,
    null
  );
  const name = languageByCode(row.language)?.name ?? row.language;
  const message = regenState ?? deleteState;

  return (
    <>
      {message && (message.error || message.success) && (
        <div className="w-full">
          <FormMessage error={message.error} success={message.success} />
        </div>
      )}

      <TranslationDetailDialog row={row} />

      <form action={regenAction}>
        <input type="hidden" name="questionId" value={row.questionId} />
        <input type="hidden" name="language" value={row.language} />
        <ConfirmSubmit
          size="xs"
          confirmVariant="default"
          title={`Regenerate the ${name} translation?`}
          confirmLabel="Regenerate"
          description="Replaces the cached text with a fresh AI translation — one OpenAI call, a few seconds. Students see the new text on their next load."
        >
          Regenerate
        </ConfirmSubmit>
      </form>

      <form action={deleteAction}>
        <input type="hidden" name="questionId" value={row.questionId} />
        <input type="hidden" name="language" value={row.language} />
        <ConfirmSubmit
          size="xs"
          title={`Delete the ${name} translation?`}
          confirmLabel="Delete"
          description="Removes the cached text for good — a student who reviews a paper in this language sees English for this question until it is translated again, and the next Translate press pays for a fresh call. Prefer Regenerate to fix a bad translation."
        >
          Delete
        </ConfirmSubmit>
      </form>
    </>
  );
}
