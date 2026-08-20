import { EXAM_DOCUMENT_RULES } from "@/lib/storage";

/**
 * Everything that disqualifies an upload, as a user-facing message; null =
 * fine. The direct sibling of courseUploadProblem (lib/courses-core.ts), and
 * for the same reason: the uploader runs it for instant feedback and the mint
 * action runs it as the authority, so the two can never disagree.
 *
 * The size branch is written as `!Number.isFinite(...)` rather than
 * `sizeBytes > max` because a NaN or zero size — which is what a failed
 * File.size read looks like — silently passes a bare comparison.
 */
export function examDocumentUploadProblem(
  contentType: string,
  sizeBytes: number
): string | null {
  if (!EXAM_DOCUMENT_RULES.mimes.includes(contentType)) {
    return `That file type isn't supported — expected ${EXAM_DOCUMENT_RULES.label}.`;
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "That file looks empty.";
  }
  if (sizeBytes > EXAM_DOCUMENT_RULES.maxBytes) {
    return `Too large — ${EXAM_DOCUMENT_RULES.label}.`;
  }
  return null;
}

/** "2.4 MB" — for the admin list and the student download links. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Short, human label for a document's type — shown next to its title. */
export function documentKindLabel(contentType: string): string {
  if (contentType === "application/pdf") return "PDF";
  if (contentType.startsWith("image/")) return "Image";
  if (contentType.includes("wordprocessingml") || contentType === "application/msword") {
    return "Word";
  }
  if (contentType.includes("presentationml") || contentType === "application/vnd.ms-powerpoint") {
    return "PowerPoint";
  }
  if (contentType.includes("spreadsheetml") || contentType === "application/vnd.ms-excel") {
    return "Excel";
  }
  return "File";
}
