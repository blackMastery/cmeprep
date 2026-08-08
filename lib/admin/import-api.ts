import type { CreationPlan, ReportLine } from "@/lib/admin/import-core";

/**
 * Wire types for the bulk-import endpoints, shared by the route handlers and
 * the client wizard. Pure types — safe to import anywhere.
 */

export type ImportReport = {
  fileErrors: string[];
  lines: ReportLine[];
  counts: {
    dataRows: number;
    valid: number;
    errorRows: number;
    warnings: number;
    skipped: number;
    withImages: number;
  };
  creationPlan: CreationPlan;
};

/**
 * Both endpoints take JSON, not multipart: the .xlsx itself goes
 * browser → Storage via a signed URL first (see `createImportUploadUrl`), so
 * all the routes need is a reference to it. `fileName` is carried purely for
 * the audit trail — the server no longer sees the original file name.
 */
export type ImportRequest = {
  objectPath: string;
  examId: string;
  autoCreate: boolean;
  fileName: string;
};

export type ImportCommitRequest = ImportRequest & { fileSha256: string };

export type ImportPreviewResponse =
  | {
      ok: true;
      fileSha256: string;
      report: ImportReport;
    }
  | { ok: false; error: string; report?: ImportReport };

export type ImportCommitResponse =
  | {
      ok: true;
      imported: number;
      images: number;
      createdExams: string[];
      createdSpecialties: string[];
      createdSubjects: string[];
    }
  | { ok: false; error: string; report?: ImportReport };

/**
 * Client-side guard only; Storage and the server enforce their own caps.
 * Matches the question-imports bucket's file_size_limit.
 */
export const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;
