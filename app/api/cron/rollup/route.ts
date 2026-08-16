import { NextResponse } from "next/server";
import { runAnalyticsBackfill, runNightlyRollup } from "@/lib/analytics";

/**
 * POST /api/cron/rollup — the nightly analytics rollup behind the admin
 * business dashboard.
 *
 * Scheduled from the database at 00:30 America/Guyana (see
 * supabase/migrations/20260819000001_admin_analytics.sql), same mechanism as
 * /api/cron/reconcile: pg_cron fires net.http_post with a bearer read from
 * Vault. `?mode=backfill` runs the resumable history load instead — invoked
 * repeatedly (usually via /api/admin/analytics/rollup) until done:true.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  // Missing secret fails closed, never "anyone may roll up" (reconcile
  // precedent).
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const mode = new URL(request.url).searchParams.get("mode");
  const summary =
    mode === "backfill" ? await runAnalyticsBackfill() : await runNightlyRollup();

  // The body is the operator readout: pg_net keeps it a few hours, and the
  // same figures go to audit_logs permanently.
  return NextResponse.json(summary);
}
