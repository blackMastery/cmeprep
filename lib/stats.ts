import "server-only";

import { createClient } from "@/lib/supabase/server";
import { calculateStreak } from "@/lib/scoring";
import type { UserStats } from "@/lib/supabase/types";

export type LifetimeStats = {
  stats: UserStats | null;
  streak: number;
};

/**
 * Lifetime aggregates for one user, shared by the dashboard and the profile
 * page. Reads the security-invoker views through the RLS'd client — they are
 * granted to `authenticated` and scoped per-user by design.
 *
 * The streak seed date is UTC "today" while `user_daily_activity` buckets by
 * America/Guyana — a pre-existing seam kept verbatim so both pages agree.
 */
export async function getLifetimeStats(userId: string): Promise<LifetimeStats> {
  const supabase = await createClient();

  const [{ data: stats }, { data: days }] = await Promise.all([
    supabase.from("user_stats").select("*").eq("user_id", userId).maybeSingle(),
    supabase
      .from("user_daily_activity")
      .select("day")
      .eq("user_id", userId)
      .order("day", { ascending: false })
      .limit(400),
  ]);

  return {
    stats: (stats as UserStats | null) ?? null,
    streak: calculateStreak(
      (days ?? []).map((d) => d.day as string),
      new Date().toISOString().slice(0, 10)
    ),
  };
}
