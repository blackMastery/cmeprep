"use client";

import { useActionState } from "react";
import { Inbox } from "lucide-react";
import type { AdminState } from "@/app/admin/subjects/actions";
import { retryEmail } from "@/app/admin/emails/actions";
import type { OutboxRow } from "@/lib/admin/emails";
import type { EmailOutboxStatus } from "@/lib/supabase/types";
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
import { AdminSubmit } from "@/components/admin/form-parts";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const STATUS_BADGE: Record<
  EmailOutboxStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  queued: "secondary",
  sent: "default",
  failed: "destructive",
  skipped: "outline",
};

export function EmailsTable({ rows }: { rows: OutboxRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Inbox className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 font-display text-lg">Nothing here</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Queued emails appear the moment an event or a scan produces one.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Template</TableHead>
            <TableHead>To</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Tries</TableHead>
            <TableHead>Detail</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                {dateFormatter.format(new Date(row.created_at))}
              </TableCell>
              <TableCell className="font-mono text-xs">{row.template}</TableCell>
              <TableCell>
                <span className="block max-w-[16rem] truncate">
                  {row.email ?? "—"}
                </span>
                {row.userName && (
                  <span className="block text-xs text-muted-foreground">
                    {row.userName}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_BADGE[row.status]}>{row.status}</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">{row.attempts}</TableCell>
              <TableCell className="max-w-[20rem] text-xs text-muted-foreground">
                {row.status === "sent" && row.sent_at
                  ? `sent ${dateFormatter.format(new Date(row.sent_at))}`
                  : row.status === "queued"
                    ? `due ${dateFormatter.format(new Date(row.scheduled_for))}`
                    : (row.skip_reason ?? row.last_error ?? "—")}
              </TableCell>
              <TableCell className="text-right">
                {(row.status === "failed" || row.status === "skipped") && (
                  <RetryButton id={row.id} />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RetryButton({ id }: { id: string }) {
  const [state, formAction] = useActionState<AdminState, FormData>(retryEmail, null);
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <AdminSubmit size="sm" variant="outline-muted">
        Retry
      </AdminSubmit>
      <FormMessage error={state?.error} success={state?.success} />
    </form>
  );
}
