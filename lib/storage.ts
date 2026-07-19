export const QUESTION_IMAGE_BUCKET = "question-images";

/**
 * Public URL for a stored question image.
 *
 * Deliberately NOT `server-only` — the admin editor's live preview is a
 * Client Component and needs it too. Built by string concatenation rather
 * than `getPublicUrl()` so a client component doesn't have to instantiate a
 * Supabase client just to format a URL. This is also the single seam to
 * change if the bucket is ever made private.
 */
export function questionImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/storage/v1/object/public/${QUESTION_IMAGE_BUCKET}/${path}`;
}

export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function extensionForType(contentType: string): string | null {
  return EXT_BY_TYPE[contentType] ?? null;
}
