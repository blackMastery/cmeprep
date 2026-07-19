"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { createImageUploadUrl } from "@/app/admin/questions/actions";
import { createClient } from "@/lib/supabase/client";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  questionImageUrl,
  QUESTION_IMAGE_BUCKET,
} from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { QuestionImage } from "@/components/test/question-image";
import { ConfirmAction } from "@/components/confirm-dialog";

/**
 * Uploads straight from the browser to Supabase Storage using a one-time
 * signed URL minted server-side.
 *
 * The bytes never pass through Next, which sidesteps the 1MB Server Action
 * body cap, the proxy's in-memory body buffer, and serverless request limits
 * all at once.
 */
export function ImageUpload({
  value,
  onChange,
  required,
  error,
}: {
  value: string | null;
  onChange: (path: string | null) => void;
  required?: boolean;
  error?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setLocalError(null);

    // Client-side checks are UX only — the action re-validates server-side.
    if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
      setLocalError("Choose a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setLocalError("Images must be 5 MB or smaller.");
      return;
    }

    setBusy(true);
    try {
      const signed = await createImageUploadUrl(file.type);
      if (!signed.ok) {
        setLocalError(signed.error);
        return;
      }

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(QUESTION_IMAGE_BUCKET)
        .uploadToSignedUrl(signed.path, signed.token, file);

      if (uploadError) {
        setLocalError("Upload failed. Try again.");
        return;
      }

      onChange(signed.path);
    } catch {
      setLocalError("Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const url = questionImageUrl(value);
  const message = error ?? localError;

  return (
    <div className="space-y-2">
      <Label>Image {required ? "" : <span className="text-muted-foreground">(optional)</span>}</Label>

      {url ? (
        <div className="space-y-2">
          <QuestionImage src={url} alt="" maxHeight={200} />
          <ConfirmAction
            variant="outline-muted"
            size="sm"
            title="Remove this image?"
            confirmLabel="Remove image"
            description={
              required
                ? "Image questions need an image, so you'll have to upload another before this one can be published."
                : "The question will no longer show an image. You can upload another at any time."
            }
            onConfirm={() => {
              onChange(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            <X data-icon="inline-start" />
            Remove image
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
              <ImagePlus data-icon="inline-start" />
              Upload image
            </>
          )}
        </Button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {message && <p className="text-xs text-destructive">{message}</p>}
    </div>
  );
}
