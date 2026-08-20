"use client";

import { useActionState, useState } from "react";
import { Download, Eye, EyeOff, FileText, Pencil, Trash2, X } from "lucide-react";
import {
  createExamDocument,
  deleteExamDocument,
  renameExamDocument,
  setExamDocumentVisibility,
} from "@/app/admin/exams/actions";
import type { AdminState } from "@/app/admin/subjects/actions";
import type { ExamDocumentSummary } from "@/lib/exam-documents";
import {
  documentKindLabel,
  formatFileSize,
} from "@/lib/exam-documents-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormMessage } from "@/components/auth/form-parts";
import { AdminField, AdminSubmit, AdminTextarea } from "@/components/admin/form-parts";
import { ConfirmSubmit } from "@/components/confirm-dialog";
import {
  ExamDocumentUpload,
  type UploadedDocument,
} from "@/components/admin/exam-document-upload";

/**
 * Syllabus and reference material for one exam. Students read these on
 * /resources, and ONLY if they have paid for this exam — the copy below says
 * so, because "upload" reads as "publish to everyone" otherwise.
 */
export function ExamDocumentsCard({
  examId,
  examName,
  documents,
}: {
  examId: string;
  examName: string;
  documents: ExamDocumentSummary[];
}) {
  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <div>
          <h2 className="font-display text-lg">Documents</h2>
          <p className="text-xs text-muted-foreground">
            Syllabus, blueprint and reference material for {examName}. Only
            students with a paid subscription for this exam can open them —
            trial users see the file count and an upgrade prompt.
          </p>
        </div>

        {documents.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            No documents yet. Upload the first one below.
          </p>
        ) : (
          <ul className="space-y-2">
            {documents.map((doc) => (
              <li key={doc.id}>
                <DocumentRow document={doc} />
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-border pt-4">
          <UploadForm examId={examId} />
        </div>
      </CardContent>
    </Card>
  );
}

function DocumentRow({ document }: { document: ExamDocumentSummary }) {
  const [editing, setEditing] = useState(false);
  const [renameState, renameAction] = useActionState<AdminState, FormData>(
    renameExamDocument,
    null
  );
  const [seenRename, setSeenRename] = useState(renameState);

  // Close on SUCCESS, not on submit — the same rule UploadForm follows below.
  // Closing in onSubmit would remount the form under the action mid-dispatch,
  // and a validation failure would throw away the title the admin just typed.
  if (renameState !== seenRename) {
    setSeenRename(renameState);
    if (renameState?.success) setEditing(false);
  }
  const [visibilityState, visibilityAction] = useActionState<
    AdminState,
    FormData
  >(setExamDocumentVisibility, null);
  const [deleteState, deleteAction] = useActionState<AdminState, FormData>(
    deleteExamDocument,
    null
  );

  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <FormMessage
        error={renameState?.error ?? visibilityState?.error ?? deleteState?.error}
        success={renameState?.success ?? visibilityState?.success}
      />

      {editing ? (
        <form action={renameAction} className="space-y-3 pt-1">
          <input type="hidden" name="id" value={document.id} />
          <AdminField
            label="Title"
            name="title"
            id={`title-${document.id}`}
            defaultValue={document.title}
            required
          />
          <AdminTextarea
            label="Description"
            name="description"
            id={`description-${document.id}`}
            defaultValue={document.description}
            rows={2}
            hint="Optional — shown under the title on the student page."
          />
          <div className="flex gap-2">
            <AdminSubmit variant="outline-muted" size="sm">
              Save
            </AdminSubmit>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
            >
              <X data-icon="inline-start" />
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <FileText
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className="truncate">{document.title}</span>
                {!document.is_published && (
                  <Badge variant="secondary">Hidden</Badge>
                )}
              </p>
              {document.description && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {document.description}
                </p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {documentKindLabel(document.content_type)} ·{" "}
                {formatFileSize(document.file_size)} · {document.file_name}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* Plain anchor: the href is a route handler that 302s to a signed
                URL, so next/link would fetch it as an RSC payload first. The
                route lets an admin through even while the document is hidden,
                which is what makes staging one checkable. */}
            <Button variant="ghost" size="xs" asChild>
              <a href={`/api/exams/documents/${document.id}`}>
                <Download data-icon="inline-start" />
                Open
              </a>
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setEditing(true)}
            >
              <Pencil data-icon="inline-start" />
              Edit
            </Button>

            <form action={visibilityAction}>
              <input type="hidden" name="id" value={document.id} />
              <input
                type="hidden"
                name="isPublished"
                value={document.is_published ? "false" : "true"}
              />
              <AdminSubmit variant="ghost" size="xs">
                {document.is_published ? (
                  <>
                    <EyeOff data-icon="inline-start" />
                    Hide
                  </>
                ) : (
                  <>
                    <Eye data-icon="inline-start" />
                    Publish
                  </>
                )}
              </AdminSubmit>
            </form>

            <form action={deleteAction}>
              <input type="hidden" name="id" value={document.id} />
              <ConfirmSubmit
                variant="ghost"
                size="xs"
                triggerLabel={`Delete ${document.title}`}
                title={`Delete "${document.title}"?`}
                confirmLabel="Delete document"
                irreversible
                description="The file is removed from storage and students lose access to it immediately."
              >
                <Trash2 data-icon="inline-start" />
                Delete
              </ConfirmSubmit>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function UploadForm({ examId }: { examId: string }) {
  const [state, action] = useActionState<AdminState, FormData>(
    createExamDocument,
    null
  );
  const [file, setFile] = useState<UploadedDocument | null>(null);
  const [seenState, setSeenState] = useState(state);

  // Clear on SUCCESS, not on submit: the hidden `path` still names the object
  // that was just filed, so leaving it in place would let a second click
  // insert a second row for the same file. Resetting in onSubmit instead
  // would remount the form out from under the action mid-dispatch.
  //
  // Adjusted during render rather than in an effect — the documented React
  // way to react to a changed value without a cascading re-render. Dropping
  // `file` unmounts the title and description inputs, so they come back
  // blank for the next upload without a form.reset().
  if (state !== seenState) {
    setSeenState(state);
    if (state?.success) setFile(null);
  }

  return (
    <form action={action} className="space-y-3">
      <FormMessage error={state?.error} success={state?.success} />

      <input type="hidden" name="examId" value={examId} />
      <input type="hidden" name="path" value={file?.path ?? ""} />
      <input type="hidden" name="fileName" value={file?.fileName ?? ""} />
      <input type="hidden" name="fileSize" value={file?.fileSize ?? ""} />
      <input type="hidden" name="contentType" value={file?.contentType ?? ""} />

      <ExamDocumentUpload examId={examId} value={file} onChange={setFile} />

      {file && (
        <>
          <AdminField
            // Keyed on the upload so picking a different file re-seeds the
            // title from ITS name rather than keeping the previous default.
            key={file.path}
            label="Title"
            name="title"
            defaultValue={file.fileName.replace(/\.[^.]+$/, "")}
            hint="What students see in the list."
            required
          />
          <AdminTextarea
            label="Description"
            name="description"
            rows={2}
            hint="Optional."
          />
          <AdminSubmit>Add document</AdminSubmit>
        </>
      )}
    </form>
  );
}
