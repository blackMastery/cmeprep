import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { isInvitePending, orgSubscriptionState } from "@/lib/orgs-core";
import type { OrgSubscriptionState } from "@/lib/orgs-core";
import { uuid } from "@/lib/validation";
import type {
  Org,
  OrgInvite,
  OrgMember,
  OrgSubscription,
  Payment,
  Plan,
  Profile,
} from "@/lib/supabase/types";

/**
 * Platform-admin reads for /admin/orgs — the sales/support console and the
 * invoice/PO fulfilment surface (SPEC §11). Callers are gated by
 * requireAdmin(); everything here trusts that and just reads.
 */

export type AdminOrgRow = {
  org: Org;
  members: number;
  pendingInvites: number;
  state: OrgSubscriptionState;
  currentPeriodEnd: string | null;
};

export async function listOrgsForAdmin(): Promise<AdminOrgRow[]> {
  const admin = createAdminClient();
  const now = new Date();

  const { data: orgs } = await admin
    .from("orgs")
    .select("*")
    .order("created_at", { ascending: false });
  const rows = (orgs ?? []) as Org[];
  if (rows.length === 0) return [];

  const ids = rows.map((o) => o.id);
  const [{ data: members }, { data: invites }, { data: subs }] =
    await Promise.all([
      admin.from("org_members").select("org_id").in("org_id", ids),
      admin
        .from("org_invites")
        .select("org_id, expires_at, accepted_at, revoked_at")
        .in("org_id", ids),
      admin.from("org_subscriptions").select("*").in("org_id", ids),
    ]);

  const memberCount = new Map<string, number>();
  for (const m of members ?? []) {
    memberCount.set(m.org_id, (memberCount.get(m.org_id) ?? 0) + 1);
  }
  const inviteCount = new Map<string, number>();
  for (const i of invites ?? []) {
    if (!isInvitePending(i, now)) continue;
    inviteCount.set(i.org_id, (inviteCount.get(i.org_id) ?? 0) + 1);
  }
  const subsByOrg = new Map<string, OrgSubscription[]>();
  for (const s of (subs ?? []) as OrgSubscription[]) {
    const list = subsByOrg.get(s.org_id) ?? [];
    list.push(s);
    subsByOrg.set(s.org_id, list);
  }

  return rows.map((org) => {
    const orgSubs = subsByOrg.get(org.id) ?? [];
    const live = orgSubs
      .filter(
        (s) =>
          s.status === "active" &&
          new Date(s.current_period_end) > now
      )
      .map((s) => s.current_period_end)
      .sort()
      .at(-1);
    return {
      org,
      members: memberCount.get(org.id) ?? 0,
      pendingInvites: inviteCount.get(org.id) ?? 0,
      state: orgSubscriptionState(orgSubs, now),
      currentPeriodEnd: live ?? null,
    };
  });
}

export type AdminOrgDetail = {
  org: Org;
  members: { member: OrgMember; profile: Profile | null; email: string | null }[];
  invites: OrgInvite[];
  subscriptions: OrgSubscription[];
  payments: Payment[];
  orgPlans: Plan[];
  state: OrgSubscriptionState;
};

export async function getOrgDetailForAdmin(
  id: string
): Promise<AdminOrgDetail | null> {
  if (!uuid().safeParse(id).success) return null;
  const admin = createAdminClient();

  const { data: org } = await admin
    .from("orgs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!org) return null;

  const [
    { data: members },
    { data: invites },
    { data: subs },
    { data: payments },
    { data: orgPlans },
  ] = await Promise.all([
    admin
      .from("org_members")
      .select("*")
      .eq("org_id", id)
      .order("joined_at", { ascending: true }),
    admin
      .from("org_invites")
      .select("*")
      .eq("org_id", id)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    admin
      .from("org_subscriptions")
      .select("*")
      .eq("org_id", id)
      .order("current_period_end", { ascending: false }),
    admin
      .from("payments")
      .select("*")
      .eq("org_id", id)
      .order("captured_at", { ascending: false })
      .limit(50),
    admin
      .from("plans")
      .select("*")
      .eq("kind", "org")
      .order("position"),
  ]);

  const memberRows = (members ?? []) as OrgMember[];
  const memberIds = memberRows.map((m) => m.user_id);
  const profileById = new Map<string, Profile>();
  const emailById = new Map<string, string | null>();
  if (memberIds.length > 0) {
    const [{ data: profiles }, { data: emails }] = await Promise.all([
      admin.from("profiles").select("*").in("id", memberIds),
      admin.from("user_emails").select("id, email").in("id", memberIds),
    ]);
    for (const p of (profiles ?? []) as Profile[]) profileById.set(p.id, p);
    for (const e of emails ?? []) emailById.set(e.id, e.email);
  }

  const subscriptions = (subs ?? []) as OrgSubscription[];

  return {
    org: org as Org,
    members: memberRows.map((member) => ({
      member,
      profile: profileById.get(member.user_id) ?? null,
      email: emailById.get(member.user_id) ?? null,
    })),
    invites: (invites ?? []) as OrgInvite[],
    subscriptions,
    payments: (payments ?? []) as Payment[],
    orgPlans: (orgPlans ?? []) as Plan[],
    state: orgSubscriptionState(subscriptions, new Date()),
  };
}
