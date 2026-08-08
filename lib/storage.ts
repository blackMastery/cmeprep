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

// ── Bulk-import workbooks ───────────────────────────────────

export const QUESTION_IMPORT_BUCKET = "question-imports";

export const IMPORT_XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Ceiling for an uploaded workbook. Matches the bucket's own file_size_limit;
 * far above the old 4 MB multipart cap because the bytes go browser → Storage
 * and never pass through a Next route.
 */
export const MAX_IMPORT_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Shape minted by `createImportUploadUrl`. Both import endpoints must run a
 * caller-supplied path through this before touching Storage: the routes are
 * admin-gated but the path itself is client-controlled, and the service-role
 * client that reads it ignores RLS. Without this an admin could point commit
 * at any object in the bucket.
 */
export function isImportObjectPath(path: string): boolean {
  return /^imports\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.xlsx$/.test(
    path
  );
}
