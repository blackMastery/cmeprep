"use client";

import { useActionState } from "react";
import { Mail } from "lucide-react";
import type { ContactMessage } from "@/lib/supabase/types";
import type { AdminState } from "@/app/admin/subjects/actions";
import {
  deleteMessage,
  setMessageHandled,
} from "@/app/admin/messages/actions";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FormMessage } from "@/components/auth/form-parts";
import { AdminSubmit } from "@/components/admin/form-parts";
import { ConfirmSubmit } from "@/components/confirm-dialog";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function MessagesTable({ rows }: { rows: ContactMessage[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Mail
            className="mx-auto size-6 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="mt-3 font-display text-lg">Nothing here</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Messages sent from the About page land here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.id}>
          <MessageCard row={row} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One message, shown in full.
 *
 * Deliberately a card list rather than a table: the body is the point, and a
 * table cell would either truncate it or need a detail route for something
 * that is only ever a few paragraphs.
 */
function MessageCard({ row }: { row: ContactMessage }) {
  const handled = Boolean(row.handled_at);

  const [handleState, handleAction] = useActionState<AdminState, FormData>(
    setMessageHandled,
    null
  );
  const [deleteState, deleteAction] = useActionState<AdminState, FormData>(
    deleteMessage,
    null
  );

  return (
    <Card
      className={cn("[--card-spacing:--spacing(5)]", handled && "opacity-70")}
    >
      <CardContent className="space-y-3">
        {(handleState?.error || deleteState?.error) && (
          <FormMessage error={handleState?.error ?? deleteState?.error} />
        )}

        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="font-medium">{row.subject}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {row.name} ·{" "}
              {/* mailto with the subject pre-filled — replying is the whole
                  point of the inbox, and there is no send-from-app path. */}
              <a
                href={`mailto:${row.email}?subject=${encodeURIComponent(`Re: ${row.subject}`)}`}
                className="text-primary underline underline-offset-2"
              >
                {row.email}
              </a>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {handled ? (
              <Badge variant="outline">Handled</Badge>
            ) : (
              <Badge>New</Badge>
            )}
            <span className="text-xs text-muted-foreground tabular-nums">
              {dateFormatter.format(new Date(row.created_at))}
            </span>
          </div>
        </div>

        {/* whitespace-pre-line: people write in paragraphs and the line breaks
            they used carry meaning. */}
        <p className="whitespace-pre-line text-sm leading-relaxed">{row.body}</p>

        <div className="flex flex-wrap items-center gap-1 border-t border-border pt-3">
          {row.user_id && (
            <span className="mr-auto text-xs text-muted-foreground">
              Sent while signed in
            </span>
          )}

          <form action={handleAction} className="ml-auto">
            <input type="hidden" name="id" value={row.id} />
            <input
              type="hidden"
              name="handled"
              value={handled ? "false" : "true"}
            />
            <AdminSubmit variant="ghost" size="xs">
              {handled ? "Reopen" : "Mark handled"}
            </AdminSubmit>
          </form>

          <form action={deleteAction}>
            <input type="hidden" name="id" value={row.id} />
            <ConfirmSubmit
              size="xs"
              title="Delete this message?"
              confirmLabel="Delete message"
              irreversible
              description={
                <>
                  The message from {row.name} is removed permanently. Copy
                  anything you still need first — unlike questions, this is a
                  hard delete with no restore.
                </>
              }
            >
              Delete
            </ConfirmSubmit>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
