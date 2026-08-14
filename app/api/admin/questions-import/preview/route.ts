import { NextResponse } from "next/server";
import {
  examInScope,
  requireContentAuthorJson,
} from "@/lib/admin/content-scope";
import { analyzeUpload, dbDuplicateWarnings } from "@/lib/admin/import";
import type { ImportPreviewResponse, ImportReport } from "@/lib/admin/import-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuid } from "@/lib/validation";

/**
 * POST /api/admin/questions-import/preview
 * JSON: { objectPath, examId, autoCreate, fileName }
 *
 * Validates everything and returns the per-row report plus the file's sha256,
 * which commit must echo back. Inserts nothing. Every row is locked to examId.
 *
 * The .xlsx is already in the question-imports bucket by the time this runs —
 * the wizard uploads it with a signed URL — so this endpoint takes only a
 * reference to it. Nothing is written to the question-images bucket here
 * either: embedded pictures are read and checked, but uploading them (and
 * fetching any URL an admin typed) is commit's job.
 */

export const maxDuration = 60;

function fail(status: number, error: string): NextResponse {
  return NextResponse.json<ImportPreviewResponse>({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  const gate = await requireContentAuthorJson();
  if ("response" in gate) return gate.response;
  const { scope } = gate.author;

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) return fail(400, "Invalid request.");

  const examIdParsed = uuid().safeParse(String(body.examId ?? ""));
  if (!examIdParsed.success) {
    return fail(400, "Open import from an exam page — examId is required.");
  }

  const admin = createAdminClient();
  // Scope pin, same posture as commit: "not yours" reads as "gone".
  if (!(await examInScope(admin, examIdParsed.data, scope))) {
    return fail(404, "That exam no longer exists.");
  }
  const { data: exam } = await admin
    .from("exams")
    .select("id, name")
    .eq("id", examIdParsed.data)
    .maybeSingle();

  if (!exam) return fail(404, "That exam no longer exists.");

  const result = await analyzeUpload(body.objectPath, body.autoCreate === true, {
    id: exam.id,
    name: exam.name,
  });
  if (!result.ok) return fail(400, result.error);

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
    fileSha256: result.fileSha256,
    report,
  });
}
