"use client";

import { useRef, useState } from "react";
import { FileUp, Loader2, X } from "lucide-react";
import { createCourseUploadUrl } from "@/app/admin/courses/actions";
import { createClient } from "@/lib/supabase/client";
import {
  COURSE_CONTENT_BUCKET,
  COURSE_COVER_RULES,
  COURSE_FILE_RULES,
  type CourseFileKind,
} from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ConfirmAction } from "@/components/confirm-dialog";

export type UploadedFile = { path: string; size: number };

/**
 * Direct-to-Storage uploader for course media — the image-upload.tsx trick
 * sized up for video: a signed URL minted server-side, bytes go browser →
 * bucket and never traverse a Next route (which caps bodies far below a
 * 500 MB MP4).
 *
 * No byte-level progress bar: supabase-js's single-shot upload doesn't
 * surface progress events, so large files show a busy state with honest
 * copy instead.
 */
export function CourseFileUpload({
  target,
  value,
  onChange,
  /** Signed preview URL for the current value, when the parent has one. */
  previewUrl,
  label = "File",
}: {
  target:
    | { kind: "cover"; courseId: string }
    | { kind: "lesson"; courseId: string; lessonId: string; fileKind: CourseFileKind };
  value: UploadedFile | null;
  onChange: (file: UploadedFile | null) => void;
  previewUrl?: string | null;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rules =
    target.kind === "cover" ? COURSE_COVER_RULES : COURSE_FILE_RULES[target.fileKind];
  const isVideo = target.kind === "lesson" && target.fileKind === "video";

  async function handleFile(file: File) {
    setError(null);

    // Client-side checks are UX only — the action re-validates server-side.
    if (!rules.mimes.includes(file.type)) {
      setError(`Choose a supported file: ${rules.label}.`);
      return;
    }
    if (file.size > rules.maxBytes) {
      setError(`Too large — ${rules.label}.`);
      return;
    }

    setBusy(true);
    try {
      const signed = await createCourseUploadUrl(
        target.kind === "cover"
          ? { kind: "cover", courseId: target.courseId }
          : { kind: "lesson", courseId: target.courseId, lessonId: target.lessonId },
        file.type,
        file.size
      );
      if (!signed.ok) {
        setError(signed.error);
        return;
      }

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(COURSE_CONTENT_BUCKET)
        .uploadToSignedUrl(signed.path, signed.token, file);
      if (uploadError) {
        setError("Upload failed. Try again.");
        return;
      }

      onChange({ path: signed.path, size: file.size });
    } catch {
      setError("Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>

      {value ? (
        <div className="space-y-2">
          {previewUrl && target.kind === "cover" ? (
            // Signed URLs are short-lived and per-render; next/image caching
            // fights that for no win on an admin preview.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt=""
              className="max-h-40 rounded-lg border object-cover"
            />
          ) : (
            <p className="truncate rounded-lg bg-muted/50 px-3 py-2 font-mono text-xs">
              {value.path.split("/").pop()}
            </p>
          )}
          <ConfirmAction
            variant="outline-muted"
            size="sm"
            title="Remove this file?"
            confirmLabel="Remove file"
            description="Save the lesson afterwards to make the removal stick. You can upload a replacement at any time."
            onConfirm={() => {
              onChange(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            <X data-icon="inline-start" />
            Remove file
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
              {isVideo ? "Uploading — large videos take a while…" : "Uploading…"}
            </>
          ) : (
            <>
              <FileUp data-icon="inline-start" />
              Upload file
            </>
          )}
        </Button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={rules.accept}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      <p className="text-xs text-muted-foreground">{rules.label}</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
