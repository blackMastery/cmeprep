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
import type { OrgActionState } from "@/app/(app)/org/(manage)/members/actions";

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

  const { error: memberError } = await admin.from("org_members").insert({
    org_id: invite.org_id,
    user_id: user.id,
    role: invite.role,
  });
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
    { inviteId: invite.id, role: invite.role },
    invite.org_id
  );

  revalidatePath("/dashboard");
  revalidatePath("/org/members");
  redirect("/dashboard");
}
