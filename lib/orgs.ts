import "server-only";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, type SessionUser } from "@/lib/auth";
import {
  assignmentStatus,
  isInvitePending,
  type AssignmentStatus,
} from "@/lib/orgs-core";
import type {
  Org,
  OrgAssignment,
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

/** Live (non-deleted) assignments, soonest deadline first. */
export async function listOrgAssignments(
  orgId: string
): Promise<OrgAssignment[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("org_assignments")
    .select("*")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .order("due_at", { ascending: true });
  return (data ?? []) as OrgAssignment[];
}

export type MemberAssignment = {
  assignment: OrgAssignment;
  status: AssignmentStatus;
  /** Latest attempt, submitted or not — where Continue/Review point. */
  latestTestId: string | null;
  latestScore: number | null;
  latestTotal: number | null;
};

/**
 * What one member owes (or has done): assignments addressed to them plus
 * their standing on each, derived from their tests via assignment_id.
 */
export async function assignmentsForMember(
  orgId: string,
  userId: string,
  now: Date = new Date()
): Promise<MemberAssignment[]> {
  const admin = createAdminClient();

  const [assignments, { data: targetRows }] = await Promise.all([
    listOrgAssignments(orgId),
    admin
      .from("org_assignment_targets")
      .select("assignment_id")
      .eq("user_id", userId),
  ]);
  const targeted = new Set((targetRows ?? []).map((t) => t.assignment_id));
  const mine = assignments.filter(
    (a) => a.audience === "all" || targeted.has(a.id)
  );
  if (mine.length === 0) return [];

  const { data: tests } = await admin
    .from("tests")
    .select("id, assignment_id, status, submitted_at, score, total_questions")
    .eq("user_id", userId)
    .in(
      "assignment_id",
      mine.map((a) => a.id)
    )
    .order("started_at", { ascending: false });

  type TestRow = {
    id: string;
    assignment_id: string | null;
    status: string;
    submitted_at: string | null;
    score: number | null;
    total_questions: number;
  };
  const byAssignment = new Map<string, TestRow[]>();
  for (const t of (tests ?? []) as TestRow[]) {
    if (!t.assignment_id) continue;
    const list = byAssignment.get(t.assignment_id) ?? [];
    list.push(t);
    byAssignment.set(t.assignment_id, list);
  }

  return mine.map((assignment) => {
    const attempts = byAssignment.get(assignment.id) ?? [];
    const submitted = attempts.filter((t) => t.status === "submitted");
    // Newest-first order above ⇒ first submitted row is the LATEST attempt,
    // which is what the org dashboard reports (SPEC §7).
    const latestSubmitted = submitted[0] ?? null;
    const latest = latestSubmitted ?? attempts[0] ?? null;

    return {
      assignment,
      status: assignmentStatus(
        {
          dueAt: assignment.due_at,
          submittedAt: latestSubmitted?.submitted_at ?? null,
          hasAttempt: attempts.length > 0,
        },
        now
      ),
      latestTestId: latest?.id ?? null,
      latestScore: latestSubmitted?.score ?? null,
      latestTotal: latestSubmitted?.total_questions ?? null,
    };
  });
}

export type AssignmentProgress = {
  assignment: OrgAssignment;
  targeted: number;
  completed: number;
  late: number;
};

/** Per-assignment completion counts for the org-admin list. */
export async function listAssignmentProgress(
  orgId: string
): Promise<AssignmentProgress[]> {
  const admin = createAdminClient();
  const assignments = await listOrgAssignments(orgId);
  if (assignments.length === 0) return [];
  const ids = assignments.map((a) => a.id);

  const [{ count: memberCount }, { data: targets }, { data: tests }] =
    await Promise.all([
      admin
        .from("org_members")
        .select("user_id", { count: "exact", head: true })
        .eq("org_id", orgId),
      admin
        .from("org_assignment_targets")
        .select("assignment_id, user_id")
        .in("assignment_id", ids),
      admin
        .from("tests")
        .select("assignment_id, user_id, submitted_at")
        .in("assignment_id", ids)
        .eq("status", "submitted"),
    ]);

  const targetCount = new Map<string, number>();
  for (const t of targets ?? []) {
    targetCount.set(t.assignment_id, (targetCount.get(t.assignment_id) ?? 0) + 1);
  }

  // One completion per member per assignment; latest submission decides late.
  const submittedBy = new Map<string, Map<string, string>>();
  for (const t of tests ?? []) {
    if (!t.assignment_id || !t.submitted_at) continue;
    const perUser = submittedBy.get(t.assignment_id) ?? new Map();
    const prev = perUser.get(t.user_id);
    if (!prev || t.submitted_at > prev) perUser.set(t.user_id, t.submitted_at);
    submittedBy.set(t.assignment_id, perUser);
  }

  return assignments.map((assignment) => {
    const perUser = submittedBy.get(assignment.id) ?? new Map<string, string>();
    let late = 0;
    for (const submittedAt of perUser.values()) {
      if (new Date(submittedAt) > new Date(assignment.due_at)) late++;
    }
    return {
      assignment,
      targeted:
        assignment.audience === "all"
          ? (memberCount ?? 0)
          : (targetCount.get(assignment.id) ?? 0),
      completed: perUser.size,
      late,
    };
  });
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
