import "server-only";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, type SessionUser } from "@/lib/auth";
import { isInvitePending } from "@/lib/orgs-core";
import type {
  Org,
  OrgInvite,
  OrgMember,
  OrgSubscription,
  Profile,
} from "@/lib/supabase/types";

/**
 * DB layer for org accounts. Everything here runs on the service-role client,
 * so every function takes or derives an org id and scopes with `.eq()` —
 * with RLS bypassed those filters are the only wall.
 */

export type OrgMembershipContext = {
  org: Org;
  membership: OrgMember;
};

/** The caller's org, if any. One org per user in v1 (unique on user_id). */
export async function getOrgMembership(
  userId: string
): Promise<OrgMembershipContext | null> {
  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("org_members")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return null;

  const { data: org } = await admin
    .from("orgs")
    .select("*")
    .eq("id", membership.org_id)
    .maybeSingle();
  // A membership pointing at a missing org row grants nothing.
  if (!org) return null;

  return { org: org as Org, membership: membership as OrgMember };
}

export type OrgAdminSession = OrgMembershipContext & { user: SessionUser };

/**
 * Gate for the org-admin area and every org-admin Server Action. Call as the
 * FIRST statement, outside try/catch — requireUser() signals by throwing
 * NEXT_REDIRECT, which a catch block would swallow.
 *
 * Deliberately does NOT block on suspension or a lapsed subscription:
 * org-admins must still reach members/billing to fix exactly those states.
 * Pages show the banners; the entitlement lock lives in orgs-core.
 */
export async function requireOrgAdmin(): Promise<OrgAdminSession> {
  const user = await requireUser();
  const ctx = await getOrgMembership(user.id);
  if (!ctx || ctx.membership.role !== "admin") redirect("/dashboard");
  return { user, ...ctx };
}

export type OrgMemberRow = {
  member: OrgMember;
  profile: Profile | null;
  email: string | null;
};

/** Roster, admins first then longest-serving first — stable for review. */
export async function listOrgMembers(orgId: string): Promise<OrgMemberRow[]> {
  const admin = createAdminClient();

  const { data: members } = await admin
    .from("org_members")
    .select("*")
    .eq("org_id", orgId)
    .order("joined_at", { ascending: true });

  const rows = (members ?? []) as OrgMember[];
  if (rows.length === 0) return [];

  const ids = rows.map((m) => m.user_id);
  const [{ data: profiles }, { data: emails }] = await Promise.all([
    admin.from("profiles").select("*").in("id", ids),
    admin.from("user_emails").select("id, email").in("id", ids),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p as Profile]));
  const emailById = new Map((emails ?? []).map((e) => [e.id, e.email]));

  return rows
    .map((member) => ({
      member,
      profile: profileById.get(member.user_id) ?? null,
      email: emailById.get(member.user_id) ?? null,
    }))
    .sort(
      (a, b) =>
        Number(b.member.role === "admin") - Number(a.member.role === "admin")
    );
}

/**
 * Invites that still matter: pending ones (occupying seats) and expired ones
 * (re-sendable). Accepted rows became members; revoked rows are noise.
 */
export async function listOrgInvites(orgId: string): Promise<OrgInvite[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("org_invites")
    .select("*")
    .eq("org_id", orgId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  return (data ?? []) as OrgInvite[];
}

export type OrgSeatUsage = {
  members: number;
  pendingInvites: number;
  seatLimit: number;
};

/** Inputs for the strict seat rule: members + pending invites ≤ limit. */
export async function getOrgSeatUsage(
  org: Org,
  now: Date = new Date()
): Promise<OrgSeatUsage> {
  const admin = createAdminClient();
  const [{ count: members }, invites] = await Promise.all([
    admin
      .from("org_members")
      .select("user_id", { count: "exact", head: true })
      .eq("org_id", org.id),
    listOrgInvites(org.id),
  ]);

  return {
    members: members ?? 0,
    pendingInvites: invites.filter((i) => isInvitePending(i, now)).length,
    seatLimit: org.seat_limit,
  };
}

/** All of an org's subscription rows, newest period first. */
export async function listOrgSubscriptions(
  orgId: string
): Promise<OrgSubscription[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("org_subscriptions")
    .select("*")
    .eq("org_id", orgId)
    .order("current_period_end", { ascending: false });
  return (data ?? []) as OrgSubscription[];
}

export type PendingInviteNotice = {
  invite: OrgInvite;
  orgName: string;
};

/**
 * The dashboard banner's lookup: a live invite addressed to this email.
 * Matching is on the citext column, so case differences don't hide it.
 */
export async function pendingInviteForEmail(
  email: string,
  now: Date = new Date()
): Promise<PendingInviteNotice | null> {
  if (email === "") return null;
  const admin = createAdminClient();

  const { data } = await admin
    .from("org_invites")
    .select("*")
    .eq("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  const invite = data as OrgInvite;
  const { data: org } = await admin
    .from("orgs")
    .select("name")
    .eq("id", invite.org_id)
    .maybeSingle();
  if (!org) return null;

  return { invite, orgName: org.name };
}
