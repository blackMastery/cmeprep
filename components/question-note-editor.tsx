"use client";

import { useActionState, useState } from "react";
import { NotebookPen } from "lucide-react";
import {
  deleteNote,
  saveNote,
  type NoteState,
} from "@/app/(app)/bookmarks/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormMessage } from "@/components/auth/form-parts";
import { ConfirmSubmit } from "@/components/confirm-dialog";

const NOTE_MAX = 2000;

/**
 * Per-question personal note, used on review cards and bookmark cards.
 * `saved` mirrors the server state locally so the preview stays truthful
 * after a save without waiting for a server re-render of the parent page.
 */
export function QuestionNoteEditor({
  questionId,
  initialBody,
}: {
  questionId: string;
  initialBody: string | null;
}) {
  const [saved, setSaved] = useState(initialBody ?? "");
  const [draft, setDraft] = useState(initialBody ?? "");
  const [editing, setEditing] = useState(false);

  const [saveState, saveAction] = useActionState<NoteState, FormData>(
    saveNote,
    null
  );
  const [deleteState, deleteAction] = useActionState<NoteState, FormData>(
    deleteNote,
    null
  );

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-xl bg-muted/50 px-4 py-3">
        {saved ? (
          <p className="min-w-0 text-sm leading-relaxed whitespace-pre-wrap text-foreground/80">
            {saved}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Keep a personal note on this question.
          </p>
        )}
        <Button
          type="button"
          variant="outline-muted"
          size="sm"
          className="shrink-0"
          onClick={() => {
            setDraft(saved);
            setEditing(true);
          }}
        >
          <NotebookPen data-icon="inline-start" />
          {saved ? "Edit note" : "Add note"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl bg-muted/50 px-4 py-3.5">
      <FormMessage
        error={saveState?.error ?? deleteState?.error}
        success={saveState?.success ?? deleteState?.success}
      />

      <form
        action={(formData) => {
          setSaved(String(formData.get("body") ?? "").trim());
          saveAction(formData);
        }}
        className="space-y-2"
      >
        <input type="hidden" name="questionId" value={questionId} />
        <Textarea
          name="body"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={NOTE_MAX}
          rows={4}
          placeholder="Why was this tricky? What should you remember next time?"
          aria-label="Your note"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {draft.length}/{NOTE_MAX}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
            >
              Close
            </Button>
            <Button type="submit" size="sm" disabled={draft.trim().length === 0}>
              Save note
            </Button>
          </div>
        </div>
      </form>

      {saved && (
        <form
          action={(formData) => {
            setSaved("");
            setDraft("");
            deleteAction(formData);
          }}
        >
          <input type="hidden" name="questionId" value={questionId} />
          <ConfirmSubmit
            title="Delete note?"
            description="Your note on this question will be permanently deleted."
            confirmLabel="Delete"
            irreversible
            variant="ghost"
            size="xs"
            className="text-destructive hover:text-destructive"
          >
            Delete note
          </ConfirmSubmit>
        </form>
      )}
    </div>
  );
}
