import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { SessionUser } from "@/lib/auth";
import {
  examAccessFor,
  type ExamAccess,
  type SubscriptionScope,
} from "@/lib/entitlements-core";

/** Either client works: admin (route handlers) or RLS'd (pages, actions). */
type DbClient =
  | ReturnType<typeof createAdminClient>
  | Awaited<ReturnType<typeof createClient>>;

/**
 * Which exams may this user practise?
 *
 * The caller passes the client it already has, so route handlers don't spin
 * up a second one. NOTE the admin client bypasses RLS — the `.eq("user_id")`
 * below is then the only thing scoping the read.
 *
 * Every row is fetched and filtered in JS rather than narrowed in SQL: the
 * stale-'active' rule already exists in isEffectivelyActive and must not be
 * re-expressed as a WHERE clause in yet another place. Rows per user are few
 * and subscriptions_user_idx covers the read.
 */
export async function examAccessFrom(
  client: DbClient,
  userId: string,
  role: SessionUser["profile"]["role"],
  now: Date = new Date()
): Promise<ExamAccess> {
  const { data } = await client
    .from("subscriptions")
    .select("status, current_period_end, exam_id")
    .eq("user_id", userId);

  return examAccessFor(role, (data ?? []) as SubscriptionScope[], now);
}

/** Convenience for Server Components, which have no client in hand. */
export async function getExamAccess(user: SessionUser): Promise<ExamAccess> {
  const supabase = await createClient();
  return examAccessFrom(supabase, user.id, user.profile.role);
}
