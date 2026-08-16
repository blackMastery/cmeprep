import type { Metadata } from "next";
import {
  getOrgSeatUsage,
  listOrgDepartments,
  listOrgInvites,
  listOrgMembers,
  requireOrgAdmin,
} from "@/lib/orgs";
import { isInvitePending } from "@/lib/orgs-core";
import { absoluteUrl } from "@/lib/site";
import { Progress } from "@/components/ui/progress";
import { DepartmentsCard } from "@/components/org/departments-card";
import {
  MembersManager,
  type InviteItem,
  type MemberItem,
} from "@/components/org/members-manager";

export const metadata: Metadata = { title: "Organisation members" };

export default async function OrgMembersPage() {
  const session = await requireOrgAdmin();
  const now = new Date();

  const [members, invites, usage, departments] = await Promise.all([
    listOrgMembers(session.org.id),
    listOrgInvites(session.org.id),
    getOrgSeatUsage(session.org, now),
    listOrgDepartments(session.org.id),
  ]);

  const departmentName = new Map(departments.map((d) => [d.id, d.name]));

  const memberItems: MemberItem[] = members.map((row) => ({
    userId: row.member.user_id,
    name: row.profile?.full_name ?? null,
    email: row.email,
    role: row.member.role,
    joinedAt: row.member.joined_at,
    departmentId: row.member.department_id,
  }));

  const inviteItems: InviteItem[] = invites.map((invite) => ({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expires_at,
    pending: isInvitePending(invite, now),
    departmentName: invite.department_id
      ? (departmentName.get(invite.department_id) ?? null)
      : null,
  }));

  const departmentItems = departments.map((d) => ({
    id: d.id,
    name: d.name,
    memberCount: members.filter((m) => m.member.department_id === d.id).length,
  }));

  const used = usage.members + usage.pendingInvites;

  return (
    <div className="space-y-6">
      <section aria-label="Seats" className="max-w-sm">
        <p className="flex items-baseline justify-between text-sm font-medium">
          Seats
          <span className="tabular-nums text-muted-foreground">
            {used}/{usage.seatLimit}
          </span>
        </p>
        <Progress
          value={Math.min(100, (used / Math.max(1, usage.seatLimit)) * 100)}
          className="mt-2 h-1.5"
          aria-label={`${used} of ${usage.seatLimit} seats used`}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          {usage.members} member{usage.members === 1 ? "" : "s"} +{" "}
          {usage.pendingInvites} pending invite
          {usage.pendingInvites === 1 ? "" : "s"}
        </p>
      </section>

      <DepartmentsCard departments={departmentItems} />

      <MembersManager
        members={memberItems}
        invites={inviteItems}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        currentUserId={session.user.id}
        joinBaseUrl={absoluteUrl("/org/join/")}
      />
    </div>
  );
}
