import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  analyticsDay,
  guyanaDayBounds,
  rangeStartFor,
  type DayPoint,
  type RangePreset,
} from "@/lib/analytics-core";
import {
  chartStartFor,
  summariseUsage,
  usageByModel,
  usageByUser,
  usageDayPoints,
  TUTOR_USAGE_TOP_USERS,
  type ModelRow,
  type UsageDayBucket,
  type UsageTotals,
  type UsageUserBucket,
  type UserRow,
} from "@/lib/tutor-usage-core";

export type TutorUsage = {
  range: RangePreset;
  /** Chart span, Guyana civil days inclusive. */
  from: string;
  to: string;
  today: string;
  totals: UsageTotals;
  /** Since Guyana midnight — the same window the daily cap counts in. */
  todayTotals: UsageTotals;
  dayPoints: { prompt: DayPoint[]; completion: DayPoint[] };
  models: ModelRow[];
  users: UserRow[];
};

/**
 * The admin usage page's one read. Two GROUP BY RPCs (PostgREST has no
 * GROUP BY of its own) rather than paging chat_messages into Node: the
 * message log grows by every question asked, and the page is opened to
 * answer "what is the tutor costing" — it should not itself be a cost.
 *
 * "Today" is carved out of the by-day rows rather than queried again: every
 * preset ends today, so the rows are already there.
 */
export async function getTutorUsage(range: RangePreset): Promise<TutorUsage> {
  const admin = createAdminClient();
  const today = analyticsDay(new Date());
  const start = rangeStartFor(range, today);
  const p_from = start === null ? null : guyanaDayBounds(start).fromIso;
  const p_to = guyanaDayBounds(today).toIso;

  const [byDay, byUser] = await Promise.all([
    admin.rpc("tutor_usage_by_day", { p_from, p_to }),
    admin.rpc("tutor_usage_by_user", { p_from, p_to, p_limit: TUTOR_USAGE_TOP_USERS }),
  ]);
  // Surfaced, not swallowed: a missing grant or a dropped function fails
  // 100% of the time and would otherwise render as "no usage yet".
  if (byDay.error) throw new Error(`tutor usage by day failed: ${byDay.error.message}`);
  if (byUser.error) throw new Error(`tutor usage by user failed: ${byUser.error.message}`);

  // bigint columns arrive as JSON numbers; Number() keeps that explicit.
  const dayRows: UsageDayBucket[] = (byDay.data ?? []).map((r) => ({
    day: r.day,
    model: r.model,
    questions: Number(r.questions),
    answers: Number(r.answers),
    measured: Number(r.measured),
    promptTokens: Number(r.prompt_tokens),
    completionTokens: Number(r.completion_tokens),
  }));
  const userRows: UsageUserBucket[] = (byUser.data ?? []).map((r) => ({
    userId: r.user_id,
    lastAt: r.last_at,
    model: r.model,
    questions: Number(r.questions),
    answers: Number(r.answers),
    measured: Number(r.measured),
    promptTokens: Number(r.prompt_tokens),
    completionTokens: Number(r.completion_tokens),
  }));

  const identity = await identitiesFor(admin, [...new Set(userRows.map((r) => r.userId))]);
  const totals = summariseUsage(dayRows);
  const from = chartStartFor(start, dayRows, today);

  return {
    range,
    from,
    to: today,
    today,
    totals,
    todayTotals: summariseUsage(dayRows.filter((r) => r.day === today)),
    dayPoints: usageDayPoints(dayRows, from, today),
    models: usageByModel(dayRows),
    users: usageByUser(userRows, totals.totalTokens, (id) =>
      identity.get(id) ?? { name: "Unknown user", email: null }
    ),
  };
}

/** Names from profiles, addresses from the service-role-only user_emails
 * view (profiles has no email column) — the lib/admin/users.ts pattern. */
async function identitiesFor(
  admin: ReturnType<typeof createAdminClient>,
  userIds: string[]
): Promise<Map<string, { name: string; email: string | null }>> {
  const out = new Map<string, { name: string; email: string | null }>();
  if (userIds.length === 0) return out;

  const [{ data: profiles }, { data: emails }] = await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", userIds),
    admin.from("user_emails").select("id, email").in("id", userIds),
  ]);
  const emailById = new Map((emails ?? []).map((e) => [e.id, e.email]));
  for (const p of profiles ?? []) {
    out.set(p.id, {
      name: p.full_name ?? "Unnamed user",
      email: emailById.get(p.id) ?? null,
    });
  }
  return out;
}
