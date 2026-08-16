import { requireAdminJson } from "@/lib/admin/api-auth";
import { getRevenueCsvRows } from "@/lib/analytics";
import { revenueCsv, DEFAULT_RANGE, type RangePreset } from "@/lib/analytics-core";
import { analyticsRangeSchema, uuid } from "@/lib/validation";

/**
 * GET /api/admin/revenue?range=…&exam=… — the revenue rollup as CSV for
 * accounting. One row per day × breakdown key, money in INTEGER CENTS: a
 * spreadsheet can divide by 100, a float round-trip cannot be trusted to.
 * Unknown params fall back to defaults, mirroring the dashboard page.
 */
export async function GET(request: Request) {
  const gate = await requireAdminJson();
  if ("response" in gate) return gate.response;

  const url = new URL(request.url);
  const parsedRange = analyticsRangeSchema.safeParse(url.searchParams.get("range"));
  const range: RangePreset = parsedRange.success ? parsedRange.data : DEFAULT_RANGE;
  const parsedExam = uuid().safeParse(url.searchParams.get("exam"));
  const examId = parsedExam.success ? parsedExam.data : null;

  const csv = revenueCsv(await getRevenueCsvRows(range, examId));

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="revenue-${range}-${stamp}.csv"`,
    },
  });
}
