import { NextResponse } from "next/server";
import { requireAdminJson } from "@/lib/admin/api-auth";
import { runAnalyticsBackfill, runNightlyRollup } from "@/lib/analytics";
import { adminRollupSchema } from "@/lib/validation";

/**
 * POST /api/admin/analytics/rollup — manual trigger for the analytics rollup,
 * so an admin can run the ship-day backfill and ad-hoc re-rolls from the
 * dashboard without holding CRON_SECRET. Same lib functions as the cron
 * route; both are idempotent, so overlapping the nightly run is safe (the
 * refund RPC is exactly-once, gross/engagement recompute to the same rows).
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  const gate = await requireAdminJson();
  if ("response" in gate) return gate.response;

  const parsed = adminRollupSchema.safeParse(
    await request.json().catch(() => ({}))
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  const summary =
    parsed.data.mode === "backfill"
      ? await runAnalyticsBackfill()
      : await runNightlyRollup();
  return NextResponse.json(summary);
}
