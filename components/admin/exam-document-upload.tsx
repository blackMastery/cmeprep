"use client";

import { useRef, useState } from "react";
import { FileUp, Loader2, X } from "lucide-react";
import {
  createExamDocumentUploadUrl,
  discardExamDocumentUpload,
} from "@/app/admin/exams/actions";
import { createClient } from "@/lib/supabase/client";
import {
  EXAM_DOCUMENT_BUCKET,
  EXAM_DOCUMENT_RULES,
  examDocumentContentType,
} from "@/lib/storage";
import { examDocumentUploadProblem } from "@/lib/exam-documents-core";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-dialog";

export type UploadedDocument = {
  path: string;
  fileName: string;
  fileSize: number;
  contentType: string;
};

/**
 * Direct-to-Storage uploader for exam documents — the course-file-upload
 * pattern, with one addition: browsers report an empty or wrong `File.type`
 * for Office formats often enough that trusting it drops legitimate .docx and
 * .xlsx uploads, so the content type is resolved from the extension when the
 * browser's guess isn't one we accept.
 */
export function ExamDocumentUpload({
  examId,
  value,
  onChange,
}: {
  examId: string;
  value: UploadedDocument | null;
  onChange: (file: UploadedDocument | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFile(file: File) {
    setError(null);

    const contentType = examDocumentContentType(file);
    if (!contentType) {
      setError(`That file type isn't supported — expected ${EXAM_DOCUMENT_RULES.label}.`);
      reset();
      return;
    }
    // Client-side checks are UX only — the action re-validates server-side.
    const problem = examDocumentUploadProblem(contentType, file.size);
    if (problem) {
      setError(problem);
      reset();
      return;
    }

    setBusy(true);
    try {
      const signed = await createExamDocumentUploadUrl(
        examId,
        contentType,
        file.size
      );
      if (!signed.ok) {
        setError(signed.error);
        return;
      }

      const supabase = createClient();
      // Re-wrap when the browser's guess was wrong. storage-js sends a Blob
      // body as a FormData part and ignores fileOptions.contentType, so the
      // part carries File.type — "" becomes application/octet-stream, which
      // the bucket's allowed_mime_types rejects with a 415. That is exactly
      // the .docx/.xlsx case examDocumentContentType exists to handle, so the
      // corrected type has to be ON the blob or the fix stops at the row.
      const body =
        file.type === contentType
          ? file
          : new File([file], file.name, { type: contentType });
      const { error: uploadError } = await supabase.storage
        .from(EXAM_DOCUMENT_BUCKET)
        .uploadToSignedUrl(signed.path, signed.token, body);
      if (uploadError) {
        setError("Upload failed. Try again.");
        return;
      }

      // Picking a second file before saving strands the first the same way a
      // discard would, so clean it up once the replacement is safely stored.
      const replaced = value?.path;

      onChange({
        path: signed.path,
        fileName: file.name,
        fileSize: file.size,
        contentType,
      });

      if (replaced && replaced !== signed.path) {
        void discardExamDocumentUpload(replaced);
      }
    } catch {
      setError("Upload failed. Try again.");
    } finally {
      setBusy(false);
      reset();
    }
  }

  return (
    <div className="space-y-2">
      {value ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate rounded-lg bg-muted/50 px-3 py-2 font-mono text-xs">
            {value.fileName}
          </p>
          <ConfirmAction
            variant="outline-muted"
            size="sm"
            title="Discard this upload?"
            confirmLabel="Discard"
            description="The file won't be saved to the exam. You can pick another one afterwards."
            onConfirm={() => {
              // Clearing the state is not enough: the bytes are already in the
              // bucket, and nothing else would ever name that path again.
              // Fire-and-forget — a failed cleanup must not block the admin
              // from picking a different file.
              void discardExamDocumentUpload(value.path);
              onChange(null);
              reset();
            }}
          >
            <X data-icon="inline-start" />
            Discard
          </ConfirmAction>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline-muted"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (
            <>
              <Loader2 className="animate-spin" data-icon="inline-start" />
              Uploading…
            </>
          ) : (
            <>
              <FileUp data-icon="inline-start" />
              Choose a file
            </>
          )}
        </Button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={EXAM_DOCUMENT_RULES.accept}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      <p className="text-xs text-muted-foreground">{EXAM_DOCUMENT_RULES.label}</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
