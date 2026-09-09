import "server-only";

import { NextResponse } from "next/server";
import { getCurrentUser, type SessionUser } from "@/lib/auth";

/**
 * Admin gate for ROUTE HANDLERS.
 *
 * `requireAdmin()` signals with redirect() — right for pages, wrong for fetch
 * endpoints, where a 307 would just confuse the client. This returns JSON
 * 401/403 instead, following the app/api/tests handlers' pattern.
 */
export async function requireAdminJson(): Promise<
  { user: SessionUser } | { response: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }
  if (user.profile.banned_at || user.profile.role !== "admin") {
    return {
      response: NextResponse.json({ error: "Admin access required" }, { status: 403 }),
    };
  }
  return { user };
}

/**
 * Bearer gate for the cron routes (/api/cron/*). Missing secret fails
 * CLOSED — 503, never "anyone may trigger a run" — and a wrong one is 401.
 * Stated once so a hardening change (timing-safe compare, a rotation
 * window accepting two values) reaches every cron route at once.
 */
export function requireCronJson(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
