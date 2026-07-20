import { NextResponse } from "next/server";
import { requireAdminJson } from "@/lib/admin/api-auth";
import { analyzeUpload, dbDuplicateWarnings } from "@/lib/admin/import";
import type { ImportPreviewResponse, ImportReport } from "@/lib/admin/import-api";

/**
 * POST /api/admin/questions-import/preview
 * FormData: file (.xlsx), autoCreate ("true"|"false")
 *
 * Validates everything and returns the per-row report plus the file's sha256,
 * which commit must echo back. Inserts nothing.
 */
export async function POST(request: Request) {
  const gate = await requireAdminJson();
  if ("response" in gate) return gate.response;

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json<ImportPreviewResponse>(
      { ok: false, error: "Invalid upload." },
      { status: 400 }
    );
  }

  const result = await analyzeUpload(
    form.get("file"),
    form.get("autoCreate") === "true"
  );
  if (!result.ok) {
    return NextResponse.json<ImportPreviewResponse>(
      { ok: false, error: result.error },
      { status: 400 }
    );
  }

  const { analysis } = result;

  // Preview-only advisory pass; commit does not recompute warnings.
  const dbWarnings = await dbDuplicateWarnings(analysis.validRows);

  const lines = [...analysis.lines, ...dbWarnings].sort(
    (a, b) => (a.row ?? 0) - (b.row ?? 0)
  );

  const report: ImportReport = {
    fileErrors: analysis.fileErrors,
    lines,
    counts: {
      ...analysis.counts,
      warnings: analysis.counts.warnings + dbWarnings.length,
    },
    creationPlan: analysis.creationPlan,
  };

  return NextResponse.json<ImportPreviewResponse>({
    ok: true,
    fileName: result.fileName,
    fileSha256: result.fileSha256,
    report,
  });
}
