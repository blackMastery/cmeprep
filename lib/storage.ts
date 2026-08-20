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

export const ORG_BRANDING_BUCKET = "org-branding";

/** Public URL for an org logo — same seam as questionImageUrl. */
export function orgLogoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/storage/v1/object/public/${ORG_BRANDING_BUCKET}/${path}`;
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

// ── Course content ──────────────────────────────────────────

/** PRIVATE bucket — lesson media is served via short-lived signed URLs
 * minted after auth + the module-unlock check, never by public URL. */
export const COURSE_CONTENT_BUCKET = "course-content";

export type CourseFileKind = "video" | "image" | "pdf";

/**
 * Per-kind caps (course-spec.md §3). The bucket's own file_size_limit is the
 * video ceiling; these tighter per-kind numbers are enforced by
 * `courseUploadProblem` (lib/courses-core.ts) before a signed URL is minted.
 */
export const COURSE_FILE_RULES: Record<
  CourseFileKind,
  { maxBytes: number; mimes: readonly string[]; accept: string; label: string }
> = {
  video: {
    maxBytes: 500 * 1024 * 1024,
    mimes: ["video/mp4"],
    accept: "video/mp4",
    label: "MP4 video up to 500 MB (1080p H.264 recommended)",
  },
  image: {
    maxBytes: 10 * 1024 * 1024,
    mimes: ["image/jpeg", "image/png", "image/webp"],
    accept: "image/jpeg,image/png,image/webp",
    label: "JPEG, PNG or WebP up to 10 MB",
  },
  pdf: {
    maxBytes: 50 * 1024 * 1024,
    mimes: ["application/pdf"],
    accept: "application/pdf",
    label: "PDF up to 50 MB (export slide decks as PDF)",
  },
};

/** Course covers reuse the image rules. */
export const COURSE_COVER_RULES = COURSE_FILE_RULES.image;

const COURSE_EXT_BY_TYPE: Record<string, string> = {
  "video/mp4": "mp4",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export function courseExtensionForType(contentType: string): string | null {
  return COURSE_EXT_BY_TYPE[contentType] ?? null;
}

/**
 * Same defence as isImportObjectPath: confirm/serve paths are client-supplied
 * and read with the service-role client, so they must match exactly the
 * shapes `createCourseUploadUrl` mints — anything else could point a lesson
 * at another course's object (or another bucket path entirely).
 */
const UUID_SEG = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function isCourseObjectPath(path: string): boolean {
  // Every path is uuid-unique (covers included) so replacing a file never
  // needs upsert on the old object — the stale one is just orphaned for the
  // future cleanup job (spec §7). Segments pin the strict 8-4-4-4-12 layout
  // like isImportObjectPath — a loose [0-9a-f-]{36} would accept paths this
  // module never minted.
  return new RegExp(
    `^courses\\/${UUID_SEG}\\/(cover\\/${UUID_SEG}|lessons\\/${UUID_SEG}\\/${UUID_SEG})\\.(mp4|jpg|png|webp|pdf)$`
  ).test(path);
}

// ── Exam documents ──────────────────────────────────────────

/** PRIVATE bucket — syllabus material is a PAID benefit, so it is served via
 * short-lived signed URLs minted only after the entitlement check in
 * app/api/exams/documents/[docId]. A public bucket would make that gate
 * cosmetic: the URL would be the file. */
export const EXAM_DOCUMENT_BUCKET = "exam-documents";

/**
 * Matches the bucket's own allowed_mime_types and file_size_limit — the
 * bucket config is the second layer, this is the one the UI and the mint
 * action read. Legacy .doc/.xls/.ppt are in deliberately: real syllabi are
 * often old files, and rejecting them would push admins into converting by
 * hand for no gain.
 */
export const EXAM_DOCUMENT_RULES: {
  maxBytes: number;
  mimes: readonly string[];
  accept: string;
  label: string;
} = {
  maxBytes: 50 * 1024 * 1024,
  mimes: [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "image/png",
    "image/jpeg",
    "image/webp",
  ],
  accept:
    ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,application/pdf",
  label: "PDF, Word, PowerPoint, Excel or an image, up to 50 MB",
};

const EXAM_DOCUMENT_EXT_BY_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function examDocumentExtensionForType(
  contentType: string
): string | null {
  return EXAM_DOCUMENT_EXT_BY_TYPE[contentType] ?? null;
}

/**
 * Browsers report an empty (or plainly wrong) `File.type` for Office files
 * often enough that trusting it drops legitimate .docx/.xlsx uploads on the
 * floor. Fall back to the extension. UX only — the mint action re-validates
 * whatever content type it is handed, so a lie here buys nothing beyond what
 * the allowlist already permits.
 */
const EXAM_DOCUMENT_TYPE_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXAM_DOCUMENT_EXT_BY_TYPE).map(([mime, ext]) => [ext, mime])
);

export function examDocumentContentType(file: {
  type: string;
  name: string;
}): string | null {
  if (EXAM_DOCUMENT_RULES.mimes.includes(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXAM_DOCUMENT_TYPE_BY_EXT[ext === "jpeg" ? "jpg" : ext] ?? null;
}

/**
 * Same defence as isCourseObjectPath: the confirm action and the download
 * route both read a client-supplied path with the service-role client, which
 * ignores RLS. Without this an admin could file another exam's object — or
 * any object — under a document row. Segments pin the strict 8-4-4-4-12
 * layout; a loose [0-9a-f-]{36} would accept paths this module never minted.
 */
export function isExamDocumentPath(path: string): boolean {
  return new RegExp(
    `^exams\\/${UUID_SEG}\\/${UUID_SEG}\\.(pdf|docx|doc|pptx|ppt|xlsx|xls|png|jpg|webp)$`
  ).test(path);
}

/** The exam a minted path is filed under, or null if the shape is wrong.
 * Callers pair this with the examId they were given — a valid-looking path
 * pointing at a different exam must not be accepted. */
export function examDocumentPathExamId(path: string): string | null {
  if (!isExamDocumentPath(path)) return null;
  return path.split("/")[1];
}
