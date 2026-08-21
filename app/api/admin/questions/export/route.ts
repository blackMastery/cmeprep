import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/admin/audit";
import {
  requireContentAuthorJson,
  scopeOrgId,
} from "@/lib/admin/content-scope";
import {
  buildExportBuffer,
  ExportTooLargeError,
  fetchQuestionsForExport,
} from "@/lib/admin/export";
import { exportFilename } from "@/lib/admin/export-core";
import { questionFiltersFromSearchParams } from "@/lib/admin/question-filters-core";
import { IMPORT_XLSX_MIME } from "@/lib/storage";

/**
 * Paging a 50k-row export plus exceljs serialisation comfortably exceeds the
 * default budget; EXPORT_ROW_CAP and this number move together.
 */
export const maxDuration = 300;

/**
 * GET /api/admin/questions/export?…list filters… — the matching questions
 * as a template-shaped workbook, answer key included.
 *
 * A plain-link download: on failure the admin lands on this URL in a tab, so
 * errors are a small HTML page with a way back rather than bare JSON.
 */
export async function GET(request: NextRequest) {
  const gate = await requireContentAuthorJson();
  if ("response" in gate) return gate.response;
  const { author } = gate;

  const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
  const filters = questionFiltersFromSearchParams(sp);
  // Org-admins are walled to their own bank no matter what exam id the query
  // string carries — the orgId filter rides the !inner joins, so a foreign
  // exam simply matches nothing.
  if (author.scope.kind === "org") filters.orgId = author.scope.orgId;
  const backHref =
    author.scope.kind === "org" ? "/org/content/questions" : "/admin/questions";

  try {
    const questions = await fetchQuestionsForExport(filters);
    const buffer = await buildExportBuffer(questions);

    // Single-exam exports are named after it; anything broader is all-exams.
    const examNames = new Set(questions.map((q) => q.examName));
    const examName =
      filters.examId || filters.specialtyId || filters.subjectId
        ? (questions[0]?.examName ?? null)
        : examNames.size === 1
          ? (questions[0]?.examName ?? null)
          : null;

    await audit(
      author.user.id,
      "question.export",
      null,
      { filters: { ...filters, page: undefined }, rows: questions.length },
      scopeOrgId(author.scope)
    );

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": IMPORT_XLSX_MIME,
        "Content-Disposition": `attachment; filename="${exportFilename(examName, new Date())}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const tooLarge = error instanceof ExportTooLargeError;
    const message = tooLarge
      ? error.message
      : "The export failed. Try again, or narrow the filters if the selection is very large.";
    if (!tooLarge) console.error("question_export_failed", error);
    return errorPage(tooLarge ? 413 : 500, message, backHref);
  }
}

function errorPage(status: number, message: string, backHref: string) {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
  const html = `<!doctype html><meta charset="utf-8"><title>Export failed</title>
<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.25rem">Export failed</h1>
<p>${esc(message)}</p>
<p><a href="${esc(backHref)}">&larr; Back to questions</a></p>`;
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
