import { NextResponse } from "next/server";
import { requireAdminJson } from "@/lib/admin/api-auth";
import { analyzeUpload, dbDuplicateWarnings } from "@/lib/admin/import";
import type { ImportPreviewResponse, ImportReport } from "@/lib/admin/import-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuid } from "@/lib/validation";

/**
 * POST /api/admin/questions-import/preview
 * FormData: file (.xlsx), autoCreate ("true"|"false"), examId (required)
 *
 * Validates everything and returns the per-row report plus the file's sha256,
 * which commit must echo back. Inserts nothing. Every row is locked to examId.
 */

export const maxDuration = 60;

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

  const examIdParsed = uuid().safeParse(String(form.get("examId") ?? ""));
  if (!examIdParsed.success) {
    return NextResponse.json<ImportPreviewResponse>(
      { ok: false, error: "Open import from an exam page — examId is required." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data: exam } = await admin
    .from("exams")
    .select("id, name")
    .eq("id", examIdParsed.data)
    .maybeSingle();

  if (!exam) {
    return NextResponse.json<ImportPreviewResponse>(
      { ok: false, error: "That exam no longer exists." },
      { status: 404 }
    );
  }

  const result = await analyzeUpload(
    form.get("file"),
    form.get("autoCreate") === "true",
    { id: exam.id, name: exam.name }
  );
  if (!result.ok) {
    return NextResponse.json<ImportPreviewResponse>(
      { ok: false, error: result.error },
      { status: 400 }
    );
  }

  const { analysis } = result;

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
