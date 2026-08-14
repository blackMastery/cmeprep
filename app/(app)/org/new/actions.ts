"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getOrgMembership } from "@/lib/orgs";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { orgNameSchema } from "@/lib/validation";
import type { OrgActionState } from "@/app/(app)/org/(manage)/members/actions";

/**
 * Path A, step one (SPEC §5): the org exists BEFORE any money moves, so the
 * capture/webhook race never has to invent an org from PayPal metadata. Any
 * signed-in user may create one — it grants nothing until a subscription
 * exists.
 */
export async function createOrg(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const user = await requireUser();

  const name = orgNameSchema.safeParse(formData.get("name"));
  if (!name.success) return { error: name.error.issues[0].message };

  // One org per account — and that includes founding one.
  const existing = await getOrgMembership(user.id);
  if (existing) {
    return {
      error: `Your account already belongs to ${existing.org.name} — one organisation per account.`,
    };
  }

  const admin = createAdminClient();
  const { data: org, error } = await admin
    .from("orgs")
    .insert({ name: name.data, created_by: user.id })
    .select("id")
    .single();
  if (error || !org) {
    console.error("org_create_failed", { userId: user.id, error });
    return { error: "Could not create the organisation." };
  }

  const { error: memberError } = await admin.from("org_members").insert({
    org_id: org.id,
    user_id: user.id,
    role: "admin",
  });
  if (memberError) {
    // Founding an org you can't administer is worse than no org — roll back.
    console.error("org_create_member_failed", {
      userId: user.id,
      orgId: org.id,
      error: memberError,
    });
    await admin.from("orgs").delete().eq("id", org.id);
    return { error: "Could not create the organisation." };
  }

  await audit(user.id, "org.create", org.id, { name: name.data }, org.id);

  redirect("/org/billing");
}
