import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { calculateStreak } from "@/lib/scoring";
import { uuid } from "@/lib/validation";
import type {
  Profile,
  Subscription,
  UserRole,
  UserStats,
} from "@/lib/supabase/types";

export const USERS_PAGE_SIZE = 20;

export type UserListFilters = {
  search?: string;
  role?: UserRole;
  page?: number;
};

export type AdminUserRow = {
  profile: Profile;
  email: string | null;
  latestSubscription: Subscription | null;
};

/** Escape ilike wildcards so a search for "100%" matches literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * PostgREST `.or()` clauses reserve `,` `(` `)` and quotes; strip anything
 * that could break out of the filter rather than trying to quote it.
 */
function sanitizeOrTerm(value: string): string {
  return value.replace(/[,()"%_\\]/g, " ").trim();
}

export async function listUsers(filters: UserListFilters): Promise<{
  rows: AdminUserRow[];
  total: number;
  page: number;
  pageCount: number;
}> {
  const admin = createAdminClient();
  const page = Math.max(1, filters.page ?? 1);
  const from = (page - 1) * USERS_PAGE_SIZE;
  const search = filters.search?.trim() ?? "";

  // Email matches come from the locked-down user_emails view (service-role
  // only). Capped at 50 ids so the id.in.(…) filter stays well under URL
  // limits — good enough for admin search; truncation is acceptable.
  let emailMatchIds: string[] = [];
  if (search !== "") {
    const { data } = await admin
      .from("user_emails")
      .select("id")
      .ilike("email", `%${escapeLike(search)}%`)
      .limit(50);
    emailMatchIds = (data ?? []).map((r) => r.id);
  }

  let query = admin
    .from("profiles")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + USERS_PAGE_SIZE - 1);

  if (filters.role) query = query.eq("role", filters.role);

  if (search !== "") {
    const term = sanitizeOrTerm(search);
    const parts: string[] = [];
    if (term !== "") parts.push(`full_name.ilike.*${term}*`);
    if (emailMatchIds.length > 0) parts.push(`id.in.(${emailMatchIds.join(",")})`);

    if (parts.length === 0) {
      // Search given but nothing survivable to match on — an empty result is
      // honest; falling through would silently return the unfiltered list.
      return { rows: [], total: 0, page, pageCount: 1 };
    }
    query = query.or(parts.join(","));
  }

  const { data: profiles, count } = await query;
  const pageRows = (profiles ?? []) as Profile[];
  const pageIds = pageRows.map((p) => p.id);
  const total = count ?? 0;

  const emailById = new Map<string, string | null>();
  const latestSubByUser = new Map<string, Subscription>();

  if (pageIds.length > 0) {
    const [{ data: emails }, { data: subs }] = await Promise.all([
      admin.from("user_emails").select("id, email").in("id", pageIds),
      admin
        .from("subscriptions")
        .select("*")
        .in("user_id", pageIds)
        .order("created_at", { ascending: false }),
    ]);

    for (const e of emails ?? []) emailById.set(e.id, e.email);
    for (const s of (subs ?? []) as Subscription[]) {
      // Rows are newest-first; first one wins per user.
      if (!latestSubByUser.has(s.user_id)) latestSubByUser.set(s.user_id, s);
    }
  }

  return {
    rows: pageRows.map((profile) => ({
      profile,
      email: emailById.get(profile.id) ?? null,
      latestSubscription: latestSubByUser.get(profile.id) ?? null,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / USERS_PAGE_SIZE)),
  };
}

export type AdminUserDetail = {
  profile: Profile;
  email: string | null;
  /** All rows, newest first. */
  subscriptions: Subscription[];
  stats: UserStats | null;
  streak: number;
  testsCount: number;
};

/**
 * Everything the admin detail page shows for one user.
 *
 * The stats views are security_invoker and the service-role client bypasses
 * RLS, so they would return EVERY user's rows — each read below must filter
 * by user_id explicitly.
 */
export async function getUserDetail(
  id: string
): Promise<AdminUserDetail | null> {
  if (!uuid().safeParse(id).success) return null;

  const admin = createAdminClient();

  const [
    { data: profile },
    { data: emailRow },
    { data: subs },
    { data: stats },
    { data: days },
    { count: testsCount },
  ] = await Promise.all([
    admin.from("profiles").select("*").eq("id", id).maybeSingle(),
    admin.from("user_emails").select("email").eq("id", id).maybeSingle(),
    admin
      .from("subscriptions")
      .select("*")
      .eq("user_id", id)
      .order("created_at", { ascending: false }),
    admin.from("user_stats").select("*").eq("user_id", id).maybeSingle(),
    admin
      .from("user_daily_activity")
      .select("day")
      .eq("user_id", id)
      .order("day", { ascending: false })
      .limit(400),
    admin
      .from("tests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", id),
  ]);

  if (!profile) return null;

  return {
    profile: profile as Profile,
    email: emailRow?.email ?? null,
    subscriptions: (subs ?? []) as Subscription[],
    stats: (stats as UserStats | null) ?? null,
    // Same UTC seed convention as lib/stats.ts getLifetimeStats.
    streak: calculateStreak(
      (days ?? []).map((d) => d.day as string),
      new Date().toISOString().slice(0, 10)
    ),
    testsCount: testsCount ?? 0,
  };
}
