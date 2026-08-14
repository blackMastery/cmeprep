"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { inviteExpiresAt, isInvitePending, seatsAvailable } from "@/lib/orgs-core";
import { absoluteUrl } from "@/lib/site";
import {
  emailSchema,
  orgMemberRoleSchema,
  orgNameSchema,
  uuid,
} from "@/lib/validation";
import type {
  Org,
  OrgInvite,
  OrgMember,
  SubStatus,
} from "@/lib/supabase/types";
import type { AdminState } from "@/app/admin/subjects/actions";

/**
 * Platform-admin org mutations — the invoice/PO fulfilment path (SPEC §5
 * Path B) plus support tooling. Every action calls requireAdmin() as its
 * FIRST statement, outside any try/catch.
 */

const SEAT_LIMIT_MAX = 10_000;

type AdminClient = ReturnType<typeof createAdminClient>;

function revalidateOrg(orgId: string) {
  revalidatePath("/admin/orgs");
  revalidatePath(`/admin/orgs/${orgId}`);
}

async function getOrg(admin: AdminClient, orgId: string): Promise<Org | null> {
  const { data } = await admin
    .from("orgs")
    .select("*")
    .eq("id", orgId)
    .maybeSingle();
  return (data as Org | null) ?? null;
}

export async function adminCreateOrg(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const actor = await requireAdmin();

  const name = orgNameSchema.safeParse(formData.get("name"));
  if (!name.success) return { error: name.error.issues[0].message };

  const admin = createAdminClient();
  const { data: org, error } = await admin
    .from("orgs")
    .insert({ name: name.data, created_by: actor.id })
    .select("id")
    .single();
  if (error || !org) return { error: "Could not create the organisation." };

  await audit(actor.id, "org.create", org.id, { name: name.data, via: "admin" }, org.id);

  redirect(`/admin/orgs/${org.id}`);
}

export async function adminUpdateOrg(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const actor = await requireAdmin();

  const id = uuid().safeParse(formData.get("orgId"));
  const name = orgNameSchema.safeParse(formData.get("name"));
  if (!id.success) return { error: "Unknown organisation." };
  if (!name.success) return { error: name.error.issues[0].message };

  const rawSeats = String(formData.get("seatLimit") ?? "").trim();
  const seats = Number(rawSeats);
  if (
    rawSeats === "" ||
    !Number.isInteger(seats) ||
    seats < 1 ||
    seats > SEAT_LIMIT_MAX
  ) {
    return { error: `Seats must be a whole number from 1 to ${SEAT_LIMIT_MAX}.` };
  }

  const admin = createAdminClient();
  const org = await getOrg(admin, id.data);
  if (!org) return { error: "Unknown organisation." };

  // Lowering below current usage is allowed: the org can remove people but
  // not add — the strict seat rule bites at invite time, not retroactively.
  const { error } = await admin
    .from("orgs")
    .update({
      name: name.data,
      seat_limit: seats,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id.data);
  if (error) return { error: "Could not update the organisation." };

  await audit(
    actor.id,
    "org.update",
    id.data,
    {
      before: { name: org.name, seatLimit: org.seat_limit },
      after: { name: name.data, seatLimit: seats },
    },
    id.data
  );
  revalidateOrg(id.data);
  return { success: "Organisation updated." };
}

export async function adminSetOrgSuspension(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const actor = await requireAdmin();

  const id = uuid().safeParse(formData.get("orgId"));
  if (!id.success) return { error: "Unknown organisation." };
  const suspend = String(formData.get("suspend")) === "true";

  const admin = createAdminClient();
  const org = await getOrg(admin, id.data);
  if (!org) return { error: "Unknown organisation." };

  const { error } = await admin
    .from("orgs")
    .update({
      suspended_at: suspend ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id.data);
  if (error) return { error: "Could not update suspension." };

  await audit(
    actor.id,
    suspend ? "org.suspend" : "org.unsuspend",
    id.data,
    { name: org.name },
    id.data
  );
  revalidateOrg(id.data);
  return { success: suspend ? "Organisation suspended." : "Suspension lifted." };
}

/**
 * The invoice/PO fulfilment step: money arrived out-of-band, the admin
 * grants (or edits) the period by hand. Mirrors saveSubscription for
 * personal rows — the picked date is the last day WITH access.
 */
export async function adminSaveOrgSubscription(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const actor = await requireAdmin();

  const orgId = uuid().safeParse(formData.get("orgId"));
  if (!orgId.success) return { error: "Unknown organisation." };

  const preset = String(formData.get("planPreset") ?? "");
  const custom = preset === "custom";

  const rawStatus = String(formData.get("status") ?? "active");
  if (!["active", "expired", "cancelled"].includes(rawStatus)) {
    return { error: "Pick a status." };
  }
  const status = rawStatus as SubStatus;

  const dateRaw = String(formData.get("currentPeriodEnd") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw) || Number.isNaN(Date.parse(dateRaw))) {
    return { error: "Pick an end date." };
  }
  const periodEnd = `${dateRaw}T23:59:59Z`;

  const planId = custom || preset === "" ? null : preset;
  if (planId && !uuid().safeParse(planId).success) {
    return { error: "Unknown plan." };
  }

  const admin = createAdminClient();
  const org = await getOrg(admin, orgId.data);
  if (!org) return { error: "Unknown organisation." };

  // Preset name comes from the plan row, never from the form — the select's
  // value is the id. Custom grants name themselves.
  let planName: string;
  if (planId) {
    const { data: planRow } = await admin
      .from("plans")
      .select("name, kind")
      .eq("id", planId)
      .maybeSingle();
    if (!planRow || planRow.kind !== "org") return { error: "Unknown plan." };
    planName = planRow.name;
  } else {
    planName = String(formData.get("planCustom") ?? "").trim();
    if (planName.length < 2) return { error: "Name the plan." };
  }

  const rawSubId = String(formData.get("orgSubscriptionId") ?? "");
  const subId = rawSubId === "" ? null : uuid().safeParse(rawSubId);
  if (subId && !subId.success) return { error: "Unknown subscription." };

  if (subId) {
    const { data: existing } = await admin
      .from("org_subscriptions")
      .select("*")
      .eq("id", subId.data)
      .maybeSingle();
    if (!existing || existing.org_id !== orgId.data) {
      return { error: "Unknown subscription." };
    }

    const { error } = await admin
      .from("org_subscriptions")
      .update({
        plan: planName,
        plan_id: planId,
        status,
        current_period_end: periodEnd,
        updated_at: new Date().toISOString(),
      })
      .eq("id", subId.data);
    if (error) return { error: "Could not update the subscription." };

    await audit(
      actor.id,
      "org_subscription.update",
      orgId.data,
      {
        orgSubscriptionId: subId.data,
        before: {
          plan: existing.plan,
          status: existing.status,
          currentPeriodEnd: existing.current_period_end,
        },
        after: { plan: planName, status, currentPeriodEnd: periodEnd },
      },
      orgId.data
    );
  } else {
    const { data, error } = await admin
      .from("org_subscriptions")
      .insert({
        org_id: orgId.data,
        plan: planName,
        plan_id: planId,
        status,
        current_period_end: periodEnd,
      })
      .select("id")
      .single();
    if (error || !data) return { error: "Could not create the subscription." };

    await audit(
      actor.id,
      "org_subscription.create",
      orgId.data,
      {
        orgSubscriptionId: data.id,
        plan: planName,
        planId,
        status,
        currentPeriodEnd: periodEnd,
        via: "admin",
      },
      orgId.data
    );
  }

  revalidateOrg(orgId.data);
  return { success: "Subscription saved." };
}

export async function adminCancelOrgSubscription(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const actor = await requireAdmin();

  const orgId = uuid().safeParse(formData.get("orgId"));
  const subId = uuid().safeParse(formData.get("orgSubscriptionId"));
  if (!orgId.success) return { error: "Unknown organisation." };
  if (!subId.success) return { error: "Unknown subscription." };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("org_subscriptions")
    .select("*")
    .eq("id", subId.data)
    .maybeSingle();
  if (!existing || existing.org_id !== orgId.data) {
    return { error: "Unknown subscription." };
  }

  const { error } = await admin
    .from("org_subscriptions")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", subId.data);
  if (error) return { error: "Could not cancel the subscription." };

  await audit(
    actor.id,
    "org_subscription.cancel",
    orgId.data,
    { orgSubscriptionId: subId.data, plan: existing.plan, via: "admin" },
    orgId.data
  );
  revalidateOrg(orgId.data);
  return { success: "Subscription cancelled." };
}

/**
 * Seat the first org-admin of a sales-led org (or help any org out). Single
 * email — bulk onboarding is the org-admin's own members page.
 */
export async function adminInviteToOrg(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const actor = await requireAdmin();
  const now = new Date();

  const orgId = uuid().safeParse(formData.get("orgId"));
  const email = emailSchema.safeParse(formData.get("email"));
  const role = orgMemberRoleSchema.safeParse(formData.get("role"));
  if (!orgId.success) return { error: "Unknown organisation." };
  if (!email.success) return { error: "Enter a valid email address." };
  if (!role.success) return { error: "Pick a role." };

  const admin = createAdminClient();
  const org = await getOrg(admin, orgId.data);
  if (!org) return { error: "Unknown organisation." };

  const [{ count: members }, { data: inviteRows }] = await Promise.all([
    admin
      .from("org_members")
      .select("user_id", { count: "exact", head: true })
      .eq("org_id", orgId.data),
    admin
      .from("org_invites")
      .select("*")
      .eq("org_id", orgId.data)
      .is("accepted_at", null)
      .is("revoked_at", null),
  ]);
  const invites = (inviteRows ?? []) as OrgInvite[];

  const existing = invites.find(
    (i) => i.email.toLowerCase() === email.data.toLowerCase()
  );
  if (existing && isInvitePending(existing, now)) {
    return { error: "That address already has a pending invite." };
  }

  if (!existing && seatsAvailable(org.seat_limit, members ?? 0, invites, now) < 1) {
    return { error: "No seats left in this organisation." };
  }

  const expiresAt = inviteExpiresAt(now).toISOString();
  if (existing) {
    const { error } = await admin
      .from("org_invites")
      .update({ role: role.data, invited_by: actor.id, expires_at: expiresAt })
      .eq("id", existing.id);
    if (error) return { error: "Could not renew the invite." };
  } else {
    const { error } = await admin.from("org_invites").insert({
      org_id: orgId.data,
      email: email.data,
      role: role.data,
      invited_by: actor.id,
      expires_at: expiresAt,
    });
    if (error) return { error: "Could not create the invite." };
  }

  // New-to-platform addresses get the auth invite email; existing accounts
  // see the dashboard banner. Same delivery rules as the org-admin path.
  const { data: owner } = await admin
    .from("user_emails")
    .select("id")
    .eq("email", email.data)
    .maybeSingle();
  if (!owner) {
    await admin.auth.admin.inviteUserByEmail(email.data, {
      redirectTo: absoluteUrl("/auth/confirm?next=/reset-password"),
    });
  }

  await audit(
    actor.id,
    "org.invite",
    null,
    { emails: [email.data], role: role.data, via: "admin" },
    orgId.data
  );
  revalidateOrg(orgId.data);
  return { success: `Invited ${email.data}.` };
}

export async function adminRemoveOrgMember(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const actor = await requireAdmin();

  const orgId = uuid().safeParse(formData.get("orgId"));
  const userId = uuid().safeParse(formData.get("userId"));
  if (!orgId.success) return { error: "Unknown organisation." };
  if (!userId.success) return { error: "Unknown member." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_members")
    .delete()
    .eq("org_id", orgId.data)
    .eq("user_id", userId.data)
    .select("role")
    .maybeSingle();
  if (error || !data) return { error: "Unknown member." };

  // No last-admin guard here on purpose: support untangles broken states,
  // and an org can sit admin-less until adminInviteToOrg seats a new one.
  await audit(
    actor.id,
    "org.member_remove",
    userId.data,
    { role: data.role, via: "admin" },
    orgId.data
  );
  revalidateOrg(orgId.data);
  return { success: "Member removed." };
}

export async function adminSetOrgMemberRole(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const actor = await requireAdmin();

  const orgId = uuid().safeParse(formData.get("orgId"));
  const userId = uuid().safeParse(formData.get("userId"));
  const role = orgMemberRoleSchema.safeParse(formData.get("role"));
  if (!orgId.success) return { error: "Unknown organisation." };
  if (!userId.success) return { error: "Unknown member." };
  if (!role.success) return { error: "Pick a role." };

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("org_members")
    .select("*")
    .eq("org_id", orgId.data)
    .eq("user_id", userId.data)
    .maybeSingle();
  if (!target) return { error: "Unknown member." };

  const before = (target as OrgMember).role;
  if (before === role.data) return { success: "No change." };

  const { error } = await admin
    .from("org_members")
    .update({ role: role.data })
    .eq("org_id", orgId.data)
    .eq("user_id", userId.data);
  if (error) return { error: "Could not change the role." };

  await audit(
    actor.id,
    "org.member_role_change",
    userId.data,
    { before, after: role.data, via: "admin" },
    orgId.data
  );
  revalidateOrg(orgId.data);
  return { success: "Role updated." };
}
