"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getOrgMembership } from "@/lib/orgs";
import { inviteAcceptBlocker, maskEmail } from "@/lib/orgs-core";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { uuid } from "@/lib/validation";
import type { OrgInvite } from "@/lib/supabase/types";
import type { OrgActionState } from "@/app/org/members/actions";

/**
 * Accepting is the one org mutation a NON-admin performs, so the guard is
 * requireUser (first statement, outside try/catch) and every other check is
 * explicit: strict email binding, the one-org rule, invite state.
 */
export async function acceptInvite(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const user = await requireUser();

  const id = uuid().safeParse(formData.get("inviteId"));
  if (!id.success) return { error: "This invite link is not valid." };

  const admin = createAdminClient();
  const { data } = await admin
    .from("org_invites")
    .select("*")
    .eq("id", id.data)
    .maybeSingle();
  if (!data) return { error: "This invite no longer exists." };
  const invite = data as OrgInvite;

  // One org per account (SPEC §1). Same org twice = harmless no-op.
  const existing = await getOrgMembership(user.id);
  if (existing && existing.org.id === invite.org_id) {
    redirect("/dashboard");
  }
  if (existing) {
    return {
      error:
        "Your account already belongs to an organisation — one per account. Contact support to move.",
    };
  }

  const blocker = inviteAcceptBlocker(invite, user.email, new Date());
  if (blocker === "revoked") {
    return { error: "This invite was revoked by your organisation." };
  }
  if (blocker === "accepted") {
    return { error: "This invite has already been used." };
  }
  if (blocker === "expired") {
    return { error: "This invite has expired — ask your admin to renew it." };
  }
  if (blocker === "email_mismatch") {
    return {
      error: `This invite is for ${maskEmail(invite.email)}. Sign in with that address, or ask your admin to invite this one.`,
    };
  }

  // The invite's department rides onto the membership. A department deleted
  // BEFORE our read already nulled invite.department_id (FK SET NULL); one
  // deleted between read and insert violates the FK — retry once without it,
  // landing the member unassigned rather than failing the join. The retry is
  // keyed to the department FK specifically so an unrelated 23503 (org or
  // profile row gone) still surfaces as the failure it is.
  const FK_VIOLATION = "23503";
  const membershipRow = (departmentId: string | null) => ({
    org_id: invite.org_id,
    user_id: user.id,
    role: invite.role,
    department_id: departmentId,
    department_changed_at: departmentId ? new Date().toISOString() : null,
  });
  // What the member actually received — the audit row must record this, not
  // the invite's pre-retry intent.
  let grantedDepartmentId = invite.department_id;
  let { error: memberError } = await admin
    .from("org_members")
    .insert(membershipRow(invite.department_id));
  if (
    memberError?.code === FK_VIOLATION &&
    invite.department_id !== null &&
    `${memberError.message} ${memberError.details ?? ""}`.includes(
      "department_id"
    )
  ) {
    grantedDepartmentId = null;
    ({ error: memberError } = await admin
      .from("org_members")
      .insert(membershipRow(null)));
  }
  if (memberError) {
    // The unique constraints already said no — either a double-click (now a
    // member of this org: fine) or a race with joining another org.
    const raced = await getOrgMembership(user.id);
    if (raced?.org.id !== invite.org_id) {
      return { error: "Could not join — try the link again." };
    }
  }

  // Mark the invite used. The membership row is what grants; a failure here
  // only costs a seat until the invite expires, so it is not rolled back.
  await admin
    .from("org_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id)
    .is("accepted_at", null);

  await audit(
    user.id,
    "org.member_join",
    user.id,
    { inviteId: invite.id, role: invite.role, departmentId: grantedDepartmentId },
    invite.org_id
  );

  revalidatePath("/dashboard");
  revalidatePath("/org/members");
  redirect("/dashboard");
}
