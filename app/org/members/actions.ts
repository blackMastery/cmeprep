"use server";

import { revalidatePath } from "next/cache";
import { requireOrgAdmin, listOrgInvites, getOrgSeatUsage } from "@/lib/orgs";
import {
  inviteExpiresAt,
  isInvitePending,
  seatsAvailable,
} from "@/lib/orgs-core";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { absoluteUrl } from "@/lib/site";
import {
  orgMemberRoleSchema,
  parseInviteEmails,
  uuid,
} from "@/lib/validation";
import type { OrgInvite, OrgMember } from "@/lib/supabase/types";

/**
 * Every action calls requireOrgAdmin() as its FIRST statement, outside any
 * try/catch — layouts do not protect Server Actions, and the guard signals
 * by throwing NEXT_REDIRECT, which a catch would swallow.
 */

export type OrgActionState = { error?: string; success?: string } | null;

/**
 * Where a brand-new invitee lands from the auth email: session established,
 * then straight to choosing a password. The org invite itself is surfaced by
 * the dashboard banner (matched on their email), so this URL never needs the
 * invite id — which keeps it on the auth redirect allow-list, which only
 * holds EXACT urls.
 */
const INVITE_REDIRECT = () => absoluteUrl("/auth/confirm?next=/reset-password");

function revalidateMembers() {
  revalidatePath("/org/members");
}

export async function inviteMembers(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();
  const now = new Date();

  const role = orgMemberRoleSchema.safeParse(formData.get("role"));
  if (!role.success) return { error: "Pick a role for the invites." };

  // Optional department, copied onto the membership at accept ("" = none).
  const rawDept = String(formData.get("departmentId") ?? "");
  let departmentId: string | null = null;
  if (rawDept !== "") {
    const dept = uuid().safeParse(rawDept);
    if (!dept.success) return { error: "Unknown department." };
    departmentId = dept.data;
  }

  const { emails, invalid } = parseInviteEmails(
    String(formData.get("emails") ?? "")
  );
  if (invalid.length > 0) {
    return { error: `Not a valid email address: ${invalid[0]}` };
  }
  if (emails.length === 0) return { error: "Enter at least one email." };

  const admin = createAdminClient();

  if (departmentId !== null) {
    const { data: dept } = await admin
      .from("org_departments")
      .select("id")
      .eq("id", departmentId)
      .eq("org_id", session.org.id)
      .maybeSingle();
    if (!dept) return { error: "Unknown department." };
  }

  // Split the batch: already a member here (skip), live invite pending
  // (skip), expired invite (renew in place — the partial unique index means
  // the row must be UPDATED, not re-inserted), otherwise brand new.
  const [{ data: emailOwners }, invites] = await Promise.all([
    admin.from("user_emails").select("id, email").in("email", emails),
    listOrgInvites(session.org.id),
  ]);

  const ownerByEmail = new Map(
    (emailOwners ?? [])
      .filter((r) => r.email !== null)
      .map((r) => [r.email!.toLowerCase(), r.id])
  );

  const ownerIds = [...ownerByEmail.values()];
  const memberIds = new Set<string>();
  if (ownerIds.length > 0) {
    const { data: existingMembers } = await admin
      .from("org_members")
      .select("user_id")
      .eq("org_id", session.org.id)
      .in("user_id", ownerIds);
    for (const m of existingMembers ?? []) memberIds.add(m.user_id);
  }

  const inviteByEmail = new Map(invites.map((i) => [i.email.toLowerCase(), i]));

  const toInsert: string[] = [];
  const toRenew: OrgInvite[] = [];
  // Live invites whose role/department differ from this batch: updated in
  // place (they already hold a seat) so the new batch's intent is never
  // silently dropped; identical live invites are skipped.
  const toUpdate: OrgInvite[] = [];
  let skipped = 0;

  for (const email of emails) {
    const ownerId = ownerByEmail.get(email);
    if (ownerId && memberIds.has(ownerId)) {
      skipped++; // already a member — nothing to do
      continue;
    }
    const existing = inviteByEmail.get(email);
    if (existing) {
      if (!isInvitePending(existing, now)) {
        toRenew.push(existing); // expired — renew, reclaiming a seat
      } else if (
        existing.role !== role.data ||
        existing.department_id !== departmentId
      ) {
        toUpdate.push(existing);
      } else {
        skipped++;
      }
      continue;
    }
    toInsert.push(email);
  }

  const wanted = toInsert.length + toRenew.length;
  if (wanted === 0 && toUpdate.length === 0) {
    return { success: "Everyone on that list is already invited or a member." };
  }

  // Strict seat rule: members + PENDING invites ≤ limit (SPEC §4). Renewed
  // invites lost their seat at expiry, so they count as new seats here.
  const usage = await getOrgSeatUsage(session.org, now);
  const available = seatsAvailable(
    usage.seatLimit,
    usage.members,
    invites,
    now
  );
  if (wanted > available) {
    return {
      error:
        available === 0
          ? `All ${usage.seatLimit} seats are taken. Remove members or revoke pending invites first.`
          : `Only ${available} seat${available === 1 ? "" : "s"} left, but this adds ${wanted} people. Trim the list or free some seats.`,
    };
  }

  const expiresAt = inviteExpiresAt(now).toISOString();

  const inserted: OrgInvite[] = [];
  if (toInsert.length > 0) {
    const { data, error } = await admin
      .from("org_invites")
      .insert(
        toInsert.map((email) => ({
          org_id: session.org.id,
          email,
          role: role.data,
          department_id: departmentId,
          invited_by: session.user.id,
          expires_at: expiresAt,
        }))
      )
      .select("*");
    if (error) return { error: "Could not create the invites." };
    inserted.push(...((data ?? []) as OrgInvite[]));
  }

  for (const invite of toRenew) {
    // Renewal re-stamps role AND department — the new batch's intent wins.
    await admin
      .from("org_invites")
      .update({
        role: role.data,
        department_id: departmentId,
        invited_by: session.user.id,
        expires_at: expiresAt,
      })
      .eq("id", invite.id)
      .is("accepted_at", null)
      .is("revoked_at", null);
  }

  for (const invite of toUpdate) {
    // Same intent-wins rule for LIVE invites, without touching expires_at —
    // the seat is already held, so this is a correction, not a renewal.
    await admin
      .from("org_invites")
      .update({
        role: role.data,
        department_id: departmentId,
        invited_by: session.user.id,
      })
      .eq("id", invite.id)
      .is("accepted_at", null)
      .is("revoked_at", null);
  }

  // Two concurrent admins can both pass the pre-check; there is no
  // transaction here, so re-count AFTER the insert and roll our rows back if
  // the org went over (SPEC §4, belt and braces). Skipped for an update-only
  // batch: it took no seats, so an over-cap org (seat_limit lowered) must
  // not fail a harmless correction.
  if (wanted > 0) {
    const after = await getOrgSeatUsage(session.org, now);
    if (after.members + after.pendingInvites > after.seatLimit) {
      if (inserted.length > 0) {
        await admin
          .from("org_invites")
          .delete()
          .in(
            "id",
            inserted.map((i) => i.id)
          );
      }
      return { error: "Someone else just used those seats — try again." };
    }
  }

  // Brand-new addresses get the Supabase auth invite email (account +
  // delivery in one step). Existing accounts get no email in v1 — the
  // dashboard banner surfaces the invite on their next visit. Delivery
  // failures are non-fatal: the invite row exists and its link still works.
  let emailed = 0;
  for (const invite of [...inserted, ...toRenew]) {
    if (ownerByEmail.has(invite.email.toLowerCase())) continue;
    const { error } = await admin.auth.admin.inviteUserByEmail(invite.email, {
      redirectTo: INVITE_REDIRECT(),
    });
    if (!error) emailed++;
  }

  await audit(
    session.user.id,
    "org.invite",
    null,
    {
      emails: [...toInsert, ...toRenew.map((i) => i.email)],
      role: role.data,
      departmentId,
      renewed: toRenew.length,
      updated: toUpdate.length,
      emailed,
      skipped,
    },
    session.org.id
  );

  revalidateMembers();
  const total = inserted.length + toRenew.length;
  const parts = [
    total > 0 ? `Invited ${total} ${total === 1 ? "person" : "people"}.` : null,
    toUpdate.length > 0
      ? `Updated ${toUpdate.length} pending invite${toUpdate.length === 1 ? "" : "s"}.`
      : null,
    skipped > 0 ? `${skipped} already invited or member.` : null,
  ].filter(Boolean);
  return { success: parts.join(" ") };
}

export async function revokeInvite(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const id = uuid().safeParse(formData.get("inviteId"));
  if (!id.success) return { error: "Unknown invite." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id.data)
    .eq("org_id", session.org.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("email")
    .maybeSingle();

  if (error || !data) return { error: "That invite is gone already." };

  await audit(
    session.user.id,
    "org.invite_revoke",
    id.data,
    { email: data.email },
    session.org.id
  );
  revalidateMembers();
  return { success: "Invite revoked." };
}

export async function resendInvite(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();
  const now = new Date();

  const id = uuid().safeParse(formData.get("inviteId"));
  if (!id.success) return { error: "Unknown invite." };

  const admin = createAdminClient();
  const { data } = await admin
    .from("org_invites")
    .select("*")
    .eq("id", id.data)
    .eq("org_id", session.org.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return { error: "That invite is gone already." };
  const invite = data as OrgInvite;

  // An EXPIRED invite gave its seat back; renewing takes one again.
  if (!isInvitePending(invite, now)) {
    const usage = await getOrgSeatUsage(session.org, now);
    if (usage.members + usage.pendingInvites >= usage.seatLimit) {
      return { error: "No seats left to renew this invite into." };
    }
  }

  const { error } = await admin
    .from("org_invites")
    .update({ expires_at: inviteExpiresAt(now).toISOString() })
    .eq("id", invite.id);
  if (error) return { error: "Could not renew the invite." };

  // Re-send only reaches addresses with no account yet; inviteUserByEmail
  // errors for existing users, which is fine — the dashboard banner covers
  // them.
  const { data: owner } = await admin
    .from("user_emails")
    .select("id")
    .eq("email", invite.email)
    .maybeSingle();
  if (!owner) {
    await admin.auth.admin.inviteUserByEmail(invite.email, {
      redirectTo: INVITE_REDIRECT(),
    });
  }

  await audit(
    session.user.id,
    "org.invite_resend",
    invite.id,
    { email: invite.email },
    session.org.id
  );
  revalidateMembers();
  return { success: "Invite renewed for another 14 days." };
}

/** True when this is the org's ONLY admin — the role that must never vanish. */
async function isLastAdmin(orgId: string, userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("role", "admin");
  const admins = (data ?? []).map((m) => m.user_id);
  return admins.length === 1 && admins[0] === userId;
}

export async function removeMember(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const id = uuid().safeParse(formData.get("userId"));
  if (!id.success) return { error: "Unknown member." };

  if (await isLastAdmin(session.org.id, id.data)) {
    return { error: "Promote another admin before removing this one." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_members")
    .delete()
    .eq("org_id", session.org.id)
    .eq("user_id", id.data)
    .select("role")
    .maybeSingle();
  if (error || !data) return { error: "Unknown member." };

  // Their account, history and any personal subscription survive — removal
  // only ends the org grant (SPEC §4).
  await audit(
    session.user.id,
    "org.member_remove",
    id.data,
    { role: data.role },
    session.org.id
  );
  revalidateMembers();
  return { success: "Member removed. Their personal account is untouched." };
}

export async function setMemberRole(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const id = uuid().safeParse(formData.get("userId"));
  const role = orgMemberRoleSchema.safeParse(formData.get("role"));
  if (!id.success) return { error: "Unknown member." };
  if (!role.success) return { error: "Pick a role." };

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("org_members")
    .select("*")
    .eq("org_id", session.org.id)
    .eq("user_id", id.data)
    .maybeSingle();
  if (!target) return { error: "Unknown member." };

  const before = (target as OrgMember).role;
  if (before === role.data) return { success: "No change." };

  if (
    role.data === "member" &&
    (await isLastAdmin(session.org.id, id.data))
  ) {
    return { error: "Promote another admin first — an org needs one." };
  }

  const { error } = await admin
    .from("org_members")
    .update({ role: role.data })
    .eq("org_id", session.org.id)
    .eq("user_id", id.data);
  if (error) return { error: "Could not change the role." };

  await audit(
    session.user.id,
    "org.member_role_change",
    id.data,
    { before, after: role.data },
    session.org.id
  );
  revalidateMembers();
  return { success: "Role updated." };
}
