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
  };
  creationPlan: CreationPlan;
};

export type ImportPreviewResponse =
  | {
      ok: true;
      fileName: string;
      fileSha256: string;
      report: ImportReport;
    }
  | { ok: false; error: string; report?: ImportReport };

export type ImportCommitResponse =
  | {
      ok: true;
      imported: number;
      createdSubjects: string[];
      createdTopics: string[];
    }
  | { ok: false; error: string; report?: ImportReport };

/** Client-side guard only; the server enforces its own cap too. */
export const MAX_IMPORT_FILE_BYTES = 4 * 1024 * 1024;
