import { NextResponse } from "next/server";
import { requireAdminJson } from "@/lib/admin/api-auth";
import { buildTemplateBuffer } from "@/lib/admin/import";

/** GET /api/admin/questions-import/template — the fill-in workbook. */
export async function GET() {
  const gate = await requireAdminJson();
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
