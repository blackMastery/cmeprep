import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { SessionUser } from "@/lib/auth";
import {
  examAccessFor,
  examDocumentAccessFor,
  type ExamAccess,
  type OrgGrantContext,
  type SubscriptionScope,
} from "@/lib/entitlements-core";

/** Either client works: admin (route handlers) or RLS'd (pages, actions). */
type DbClient =
  | ReturnType<typeof createAdminClient>
  | Awaited<ReturnType<typeof createClient>>;

/**
 * The caller's org, if any, as examAccessFor wants it. Exported for pages
 * that compute access from rows they already hold (the dashboard). Whether
 * the org GRANTS anything (grace, suspension, lapsed subs) is decided in
 * orgs-core, not here — this only fetches.
 *
 * With the RLS client the org_members/orgs/org_subscriptions policies scope
 * these reads; with the admin client the `.eq` filters are the only scoping,
 * same caveat as examAccessFrom below.
 */
export async function orgGrantContextFrom(
  client: DbClient,
  userId: string
): Promise<OrgGrantContext | null> {
  const { data: membership } = await client
    .from("org_members")
    .select("org_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return null;

  const [{ data: org }, { data: subs }] = await Promise.all([
    client
      .from("orgs")
      .select("suspended_at")
      .eq("id", membership.org_id)
      .maybeSingle(),
    client
      .from("org_subscriptions")
      // exam_id: org purchases are per exam; the rider is built from it.
      .select("status, current_period_end, exam_id")
      .eq("org_id", membership.org_id),
  ]);
  // A membership row whose org row can't be read grants nothing.
  if (!org) return null;

  return {
    org_id: membership.org_id,
    suspended_at: org.suspended_at,
    subs: (subs ?? []) as SubscriptionScope[],
  };
}

/**
 * Which exams may this user practise?
 *
 * The caller passes the client it already has, so route handlers don't spin
 * up a second one. NOTE the admin client bypasses RLS — the `.eq("user_id")`
 * below is then the only thing scoping the read.
 *
 * Every row is fetched and filtered in JS rather than narrowed in SQL: the
 * stale-'active' rule already exists in isEffectivelyActive (and the org
 * grace rule in orgs-core) and must not be re-expressed as a WHERE clause in
 * yet another place. Rows per user are few and subscriptions_user_idx covers
 * the read.
 */
export async function examAccessFrom(
  client: DbClient,
  userId: string,
  role: SessionUser["profile"]["role"],
  now: Date = new Date()
): Promise<ExamAccess> {
  const { subs, org } = await accessInputs(client, userId);
  return examAccessFor(role, subs, org, now);
}

/** Convenience for Server Components, which have no client in hand. */
export async function getExamAccess(user: SessionUser): Promise<ExamAccess> {
  const supabase = await createClient();
  return examAccessFrom(supabase, user.id, user.profile.role);
}

/**
 * The rows both access rules read. Shared so asking for document access costs
 * the same two queries as asking for practice access, and so the two can
 * never end up reading a different set of subscriptions.
 */
async function accessInputs(
  client: DbClient,
  userId: string
): Promise<{ subs: SubscriptionScope[]; org: OrgGrantContext | null }> {
  const [{ data }, org] = await Promise.all([
    client
      .from("subscriptions")
      .select("status, current_period_end, exam_id")
      .eq("user_id", userId),
    orgGrantContextFrom(client, userId),
  ]);
  return { subs: (data ?? []) as SubscriptionScope[], org };
}

/**
 * Which exams' DOCUMENTS may this user read? Same rows as examAccessFrom,
 * narrowed by examDocumentAccessFor to what was actually paid for — a trial
 * allowance does not buy the syllabus.
 */
export async function examDocumentAccessFrom(
  client: DbClient,
  userId: string,
  role: SessionUser["profile"]["role"],
  now: Date = new Date()
): Promise<ExamAccess> {
  const { subs, org } = await accessInputs(client, userId);
  return examDocumentAccessFor(role, subs, org, now);
}

/** Convenience for Server Components — the /resources page. */
export async function getExamDocumentAccess(
  user: SessionUser
): Promise<ExamAccess> {
  const supabase = await createClient();
  return examDocumentAccessFrom(supabase, user.id, user.profile.role);
}
