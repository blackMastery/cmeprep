import { NextResponse } from "next/server";
import { requireContentAuthorJson } from "@/lib/admin/content-scope";
import { buildTemplateBuffer } from "@/lib/admin/import";

/** GET /api/admin/questions-import/template — the fill-in workbook. */
export async function GET() {
  const gate = await requireContentAuthorJson();
  if ("response" in gate) return gate.response;

  const buffer = await buildTemplateBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="cmeprep-question-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
