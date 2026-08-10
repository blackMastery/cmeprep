import { NextResponse } from "next/server";
import { runReconciliationSweep } from "@/lib/reconcile";

/**
 * POST /api/cron/reconcile — the reconciliation cron named in
 * exam-app-development-plan.md's risk register.
 *
 * Scheduled from the database: pg_cron fires net.http_post at this route with a
 * bearer token read from Supabase Vault (see
 * supabase/migrations/20260810000002_payment_reconciliation.sql). It lives here
 * rather than in SQL or an edge function because the repairs re-run the very
 * same webhook handlers the app already has, in lib/paypal-events.ts, and call
 * PayPal through lib/paypal.ts.
 *
 * 60s matches the house ceiling for long routes (see
 * app/api/admin/questions-import/commit/route.ts). The sweep budgets against it
 * internally rather than relying on batch caps alone, because each PayPal
 * lookup is an unbounded network call.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  // Not configured (local dev, or a production env var someone forgot): refuse
  // to run rather than run unauthenticated. Same posture as the PayPal webhook
  // route's PAYPAL_WEBHOOK_ID 503 — a missing secret must never degrade into
  // "anyone may trigger a sweep".
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const summary = await runReconciliationSweep();

  // The body is the operator readout: pg_net stores it in net._http_response
  // for a few hours, and the same figures go to audit_logs permanently.
  return NextResponse.json(summary);
}
