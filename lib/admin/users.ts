import "server-only";
import { escapeLike } from "@/lib/admin/question-filters-core";
import {
  isProfileSort,
  profileOrderColumn,
  sortUserSortRows,
  type UserSortKey,
  type UserSortRow,
} from "@/lib/admin/users-core";

import { createAdminClient } from "@/lib/supabase/admin";
import { calculateStreak } from "@/lib/scoring";
import { uuid } from "@/lib/validation";
import type {
  Profile,
  Subscription,
  UserRole,
  UserStats,
} from "@/lib/supabase/types";

export { USER_SORTS, type UserSortKey } from "@/lib/admin/users-core";

export const USERS_PAGE_SIZE = 20;

const IN_CHUNK = 200;

export type UserListFilters = {
  search?: string;
  role?: UserRole;
  page?: number;
  sort?: UserSortKey;
  /** asc | desc — default depends on the column (joined defaults to desc). */
  dir?: "asc" | "desc";
};

export type AdminUserRow = {
  profile: Profile;
  email: string | null;
  latestSubscription: Subscription | null;
  /** Submitted answers (attempts rows) — same figure as the detail page. */
  questionsAttempted: number;
  /** Tests started, any status — matches getUserDetail's testsCount. */
  testsCount: number;
};

/**
 * PostgREST `.or()` clauses reserve `,` `(` `)` and quotes; strip anything
 * that could break out of the filter rather than trying to quote it.
 */
function sanitizeOrTerm(value: string): string {
  return value.replace(/[,()"%_\\]/g, " ").trim();
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function sortAscending(sort: UserSortKey, dir: "asc" | "desc" | undefined): boolean {
  return sort === "joined" ? dir === "asc" : dir !== "desc";
}

/** PostgREST `.or()` clause, or null when the search cannot match anything. */
function searchOrClause(
  search: string,
  emailMatchIds: string[]
): string | null {
  const term = sanitizeOrTerm(search);
  const parts: string[] = [];
  if (term !== "") parts.push(`full_name.ilike.*${term}*`);
  if (emailMatchIds.length > 0) parts.push(`id.in.(${emailMatchIds.join(",")})`);
  if (parts.length === 0) return null;
  return parts.join(",");
}

async function enrichUserRows(
  admin: ReturnType<typeof createAdminClient>,
  pageRows: Profile[]
): Promise<AdminUserRow[]> {
  const pageIds = pageRows.map((p) => p.id);

  const emailById = new Map<string, string | null>();
  const latestSubByUser = new Map<string, Subscription>();
  const attemptedByUser = new Map<string, number>();
  const testsByUser = new Map<string, number>();

  if (pageIds.length === 0) return [];

  // user_stats is security_invoker and the admin client bypasses RLS, so
  // it must be filtered to the page explicitly (see getUserDetail). Test
  // counts are tallied here: PostgREST has no GROUP BY, and one page is
  // at most 20 users' worth of id-only rows.
  const [{ data: emails }, { data: subs }, { data: stats }, { data: tests }] =
    await Promise.all([
      admin.from("user_emails").select("id, email").in("id", pageIds),
      admin
        .from("subscriptions")
        .select("*")
        .in("user_id", pageIds)
        .order("created_at", { ascending: false }),
      admin
        .from("user_stats")
        .select("user_id, attempted")
        .in("user_id", pageIds),
      admin.from("tests").select("user_id").in("user_id", pageIds),
    ]);

  for (const e of emails ?? []) emailById.set(e.id, e.email);
  for (const s of (subs ?? []) as Subscription[]) {
    // Rows are newest-first; first one wins per user.
    if (!latestSubByUser.has(s.user_id)) latestSubByUser.set(s.user_id, s);
  }
  for (const st of stats ?? []) attemptedByUser.set(st.user_id, st.attempted);
  for (const t of tests ?? []) {
    testsByUser.set(t.user_id, (testsByUser.get(t.user_id) ?? 0) + 1);
  }

  return pageRows.map((profile) => ({
    profile,
    email: emailById.get(profile.id) ?? null,
    latestSubscription: latestSubByUser.get(profile.id) ?? null,
    questionsAttempted: attemptedByUser.get(profile.id) ?? 0,
    testsCount: testsByUser.get(profile.id) ?? 0,
  }));
}

/** Sort keys for columns that live outside profiles — fetch all matches, sort in memory, then slice. */
async function listUsersComputedSort(
  admin: ReturnType<typeof createAdminClient>,
  filters: UserListFilters,
  sort: UserSortKey,
  ascending: boolean,
  page: number,
  from: number,
  search: string,
  emailMatchIds: string[]
): Promise<{
  rows: AdminUserRow[];
  total: number;
  page: number;
  pageCount: number;
}> {
  let idQuery = admin
    .from("profiles")
    .select("id, full_name, role, created_at", { count: "exact" });

  if (filters.role) idQuery = idQuery.eq("role", filters.role);
  if (search !== "") {
    const orClause = searchOrClause(search, emailMatchIds);
    if (orClause === null) {
      return { rows: [], total: 0, page, pageCount: 1 };
    }
    idQuery = idQuery.or(orClause);
  }

  const { data: matches, count } = await idQuery;
  const total = count ?? 0;
  const matchRows = matches ?? [];
  if (matchRows.length === 0) {
    return { rows: [], total: 0, page, pageCount: 1 };
  }

  const allIds = matchRows.map((p) => p.id);
  const emailById = new Map<string, string | null>();
  const planEndByUser = new Map<string, string>();
  const attemptedByUser = new Map<string, number>();
  const testsByUser = new Map<string, number>();

  for (const ids of chunk(allIds, IN_CHUNK)) {
    const [{ data: emails }, { data: subs }, { data: stats }, { data: tests }] =
      await Promise.all([
        admin.from("user_emails").select("id, email").in("id", ids),
        admin
          .from("subscriptions")
          .select("user_id, current_period_end, created_at")
          .in("user_id", ids)
          .order("created_at", { ascending: false }),
        admin
          .from("user_stats")
          .select("user_id, attempted")
          .in("user_id", ids),
        admin.from("tests").select("user_id").in("user_id", ids),
      ]);

    for (const e of emails ?? []) emailById.set(e.id, e.email);
    for (const s of subs ?? []) {
      if (!planEndByUser.has(s.user_id)) {
        planEndByUser.set(s.user_id, s.current_period_end as string);
      }
    }
    for (const st of stats ?? []) attemptedByUser.set(st.user_id, st.attempted);
    for (const t of tests ?? []) {
      testsByUser.set(t.user_id, (testsByUser.get(t.user_id) ?? 0) + 1);
    }
  }

  const sortRows: UserSortRow[] = matchRows.map((p) => ({
    id: p.id,
    name: p.full_name,
    email: emailById.get(p.id) ?? null,
    role: p.role as UserRole,
    planEnd: planEndByUser.get(p.id) ?? null,
    questions: attemptedByUser.get(p.id) ?? 0,
    tests: testsByUser.get(p.id) ?? 0,
    joined: p.created_at as string,
  }));

  const pageIds = sortUserSortRows(sortRows, sort, ascending)
    .slice(from, from + USERS_PAGE_SIZE)
    .map((r) => r.id);

  if (pageIds.length === 0) {
    return {
      rows: [],
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / USERS_PAGE_SIZE)),
    };
  }

  const { data: profiles } = await admin
    .from("profiles")
    .select("*")
    .in("id", pageIds);
  const profileById = new Map(
    ((profiles ?? []) as Profile[]).map((p) => [p.id, p])
  );
  const pageRows = pageIds
    .map((id) => profileById.get(id))
    .filter((p): p is Profile => p !== undefined);

  return {
    rows: await enrichUserRows(admin, pageRows),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / USERS_PAGE_SIZE)),
  };
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
  const sort = filters.sort ?? "joined";
  const ascending = sortAscending(sort, filters.dir);

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

  if (!isProfileSort(sort)) {
    return listUsersComputedSort(
      admin,
      filters,
      sort,
      ascending,
      page,
      from,
      search,
      emailMatchIds
    );
  }

  let query = admin.from("profiles").select("*", { count: "exact" });

  if (filters.role) query = query.eq("role", filters.role);
  if (search !== "") {
    const orClause = searchOrClause(search, emailMatchIds);
    if (orClause === null) {
      return { rows: [], total: 0, page, pageCount: 1 };
    }
    query = query.or(orClause);
  }

  query = query
    .order(profileOrderColumn(sort), {
      ascending,
      nullsFirst: false,
    })
    .range(from, from + USERS_PAGE_SIZE - 1);

  const { data: profiles, count } = await query;
  const pageRows = (profiles ?? []) as Profile[];
  const total = count ?? 0;

  return {
    rows: await enrichUserRows(admin, pageRows),
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
