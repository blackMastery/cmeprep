import { NextResponse } from "next/server";
import { requireCronJson } from "@/lib/admin/api-auth";
import { audit } from "@/lib/admin/audit";
import { deliverOutbox } from "@/lib/email";
import { runNotificationScan } from "@/lib/notification-scans";

/**
 * POST /api/cron/email — the email outbox worker (notifications-plan.md).
 *
 * Two jobs behind one route, picked by the JSON body `{ job }` (or `?job=`
 * for a curl by hand):
 *
 *  - `deliver` (every 5 minutes): send due email_outbox rows.
 *  - `scan` (daily, 08:00 America/Guyana): queue the time-based reminders —
 *    access expiring, assignments due/overdue/closed, the weekly digest.
 *
 * Scheduled from the database like /api/cron/reconcile (see
 * supabase/migrations/20260909000001_email_notifications.sql). 60s matches
 * the house ceiling for long routes; both jobs budget against it internally.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  const denied = requireCronJson(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as { job?: unknown } | null;
  const job =
    (typeof body?.job === "string" ? body.job : null) ??
    new URL(request.url).searchParams.get("job") ??
    "deliver";
  if (job !== "deliver" && job !== "scan") {
    return NextResponse.json({ error: "unknown_job" }, { status: 400 });
  }

  try {
    const summary =
      job === "scan"
        ? await runNotificationScan()
        : await deliverOutbox({ source: "schedule" });
    // The body is the operator readout: pg_net keeps it a few hours, and the
    // same figures go to audit_logs.
    return NextResponse.json({ job, ...summary });
  } catch (error) {
    // deliverOutbox throws for one thing only — EMAIL_TRANSPORT=resend
    // without its keys — and pg_net's 5xx log is read by nobody. The audit
    // row is what /admin/emails shows, so the misconfiguration is visible
    // there as a failed last run instead of a queue that silently grows.
    const message = error instanceof Error ? error.message : String(error);
    console.error("email_cron_failed", { job, error: message });
    await audit(null, job === "scan" ? "email.scan" : "email.deliver", null, {
      error: message,
    });
    return NextResponse.json({ job, error: message }, { status: 503 });
  }
}
