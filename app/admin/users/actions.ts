"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import {
  subscriptionSchema,
  trialsLimitSchema,
  userRoleSchema,
  uuid,
} from "@/lib/validation";
import type { Profile } from "@/lib/supabase/types";
import type { AdminState } from "@/app/admin/subjects/actions";

/**
 * Every action calls requireAdmin() as its FIRST statement, outside any
 * try/catch — the admin layout does not protect Server Actions, and
 * requireAdmin() throws NEXT_REDIRECT which a catch would swallow.
 */

function revalidateUser(userId: string) {
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
}

type AdminClient = ReturnType<typeof createAdminClient>;

async function getTargetProfile(
  admin: AdminClient,
  userId: string
): Promise<Profile | null> {
  const { data } = await admin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  return (data as Profile | null) ?? null;
}

/**
 * Entitlement rule: ANY subscription row with status='active' AND
 * current_period_end > now() ⇒ 'student'; otherwise ⇒ 'trial'.
 * Admins are never auto-changed; manual role edits stand until the next
 * subscription mutation for that user runs this sync again.
 */
async function syncRoleFromSubscriptions(
  admin: AdminClient,
  actorId: string,
  userId: string
): Promise<void> {
  const target = await getTargetProfile(admin, userId);
  if (!target || target.role === "admin") return;

  const { count } = await admin
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("current_period_end", new Date().toISOString());

  const next = (count ?? 0) > 0 ? "student" : "trial";
  if (next === target.role) return;

  const { error } = await admin
    .from("profiles")
    .update({ role: next, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (!error) {
    await audit(actorId, "user.role_change", userId, {
      before: target.role,
      after: next,
      via: "subscription_sync",
    });
  }
}

export async function updateUserRole(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const actor = await requireAdmin();

  const id = uuid().safeParse(formData.get("userId"));
  const role = userRoleSchema.safeParse(formData.get("role"));
  if (!id.success) return { error: "Unknown user." };
  if (!role.success) return { error: "Pick a role." };

  // Lockout-proofing: the acting admin always survives, so the last admin
  // can never vanish. Demoting a DIFFERENT admin is allowed on purpose.
  if (id.data === actor.id) {
    return { error: "You cannot change your own role." };
  }

  const admin = createAdminClient();
  const target = await getTargetProfile(admin, id.data);
  if (!target) return { error: "Unknown user." };
  if (target.role === role.data) return { success: "No change." };

  const { error } = await admin
    .from("profiles")
    .update({ role: role.data, updated_at: new Date().toISOString() })
    .eq("id", id.data);

  if (error) return { error: "Could not update the role." };

  await audit(actor.id, "user.role_change", id.data, {
    before: target.role,
    after: role.data,
  });
  revalidateUser(id.data);
  return { success: "Role updated." };
}

export async function setTrialsLimit(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const actor = await requireAdmin();

  const id = uuid().safeParse(formData.get("userId"));
  if (!id.success) return { error: "Unknown user." };

  // Reject empty BEFORE parsing — z.coerce would turn "" into 0.
  const raw = String(formData.get("trialsLimit") ?? "").trim();
  if (raw === "") return { error: "Enter a trial limit." };

  const limit = trialsLimitSchema.safeParse(raw);
  if (!limit.success) return { error: limit.error.issues[0].message };

  const admin = createAdminClient();
  const target = await getTargetProfile(admin, id.data);
  if (!target) return { error: "Unknown user." };

  const { error } = await admin
    .from("profiles")
    .update({ trials_limit: limit.data, updated_at: new Date().toISOString() })
    .eq("id", id.data);

  if (error) return { error: "Could not update the trial limit." };

  await audit(actor.id, "user.trials_change", id.data, {
    before: target.trials_limit,
    after: limit.data,
  });
  revalidateUser(id.data);
  return { success: "Trial limit updated." };
}

export async function resetTrialsUsed(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const actor = await requireAdmin();

  const id = uuid().safeParse(formData.get("userId"));
  if (!id.success) return { error: "Unknown user." };

  const admin = createAdminClient();
  const target = await getTargetProfile(admin, id.data);
  if (!target) return { error: "Unknown user." };

  const { error } = await admin
    .from("profiles")
    .update({ trials_used: 0, updated_at: new Date().toISOString() })
    .eq("id", id.data);

  if (error) return { error: "Could not reset the used tests." };

  await audit(actor.id, "user.reset_trials", id.data, {
    before: target.trials_used,
  });
  revalidateUser(id.data);
  return { success: "Used tests reset to 0." };
}

export async function banUser(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const actor = await requireAdmin();

  const id = uuid().safeParse(formData.get("userId"));
  if (!id.success) return { error: "Unknown user." };
  if (id.data === actor.id) return { error: "You cannot ban yourself." };

  const admin = createAdminClient();
  const target = await getTargetProfile(admin, id.data);
  if (!target) return { error: "Unknown user." };

  // App-level gate: requireUser bounces banned users to /banned on their
  // next request. The auth session itself is not revoked — existing design.
  const { error } = await admin
    .from("profiles")
    .update({
      banned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id.data);

  if (error) return { error: "Could not ban the user." };

  await audit(actor.id, "user.ban", id.data);
  revalidateUser(id.data);
  return { success: "User banned." };
}

export async function unbanUser(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const actor = await requireAdmin();

  const id = uuid().safeParse(formData.get("userId"));
  if (!id.success) return { error: "Unknown user." };

  const admin = createAdminClient();
  const target = await getTargetProfile(admin, id.data);
  if (!target) return { error: "Unknown user." };

  const { error } = await admin
    .from("profiles")
    .update({ banned_at: null, updated_at: new Date().toISOString() })
    .eq("id", id.data);

  if (error) return { error: "Could not unban the user." };

  await audit(actor.id, "user.unban", id.data);
  revalidateUser(id.data);
  return { success: "User unbanned." };
}

export async function saveSubscription(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const actor = await requireAdmin();

  const id = uuid().safeParse(formData.get("userId"));
  if (!id.success) return { error: "Unknown user." };

  const preset = String(formData.get("planPreset") ?? "");
  const plan =
    preset === "custom" ? String(formData.get("planCustom") ?? "") : preset;

  const parsed = subscriptionSchema.safeParse({
    plan,
    status: formData.get("status"),
    currentPeriodEnd: formData.get("currentPeriodEnd"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // End-of-day UTC: the picked date is the last day WITH access.
  const periodEnd = `${parsed.data.currentPeriodEnd}T23:59:59Z`;

  const admin = createAdminClient();
  const target = await getTargetProfile(admin, id.data);
  if (!target) return { error: "Unknown user." };

  const rawSubId = String(formData.get("subscriptionId") ?? "");
  const subId = rawSubId === "" ? null : uuid().safeParse(rawSubId);
  if (subId && !subId.success) return { error: "Unknown subscription." };

  if (subId) {
    // Update an existing row (PayPal-linked rows stay editable by design —
    // the admin override wins over webhook state).
    const { data: existing } = await admin
      .from("subscriptions")
      .select("*")
      .eq("id", subId.data)
      .maybeSingle();

    if (!existing || existing.user_id !== id.data) {
      return { error: "Unknown subscription." };
    }

    const { error } = await admin
      .from("subscriptions")
      .update({
        plan: parsed.data.plan,
        status: parsed.data.status,
        current_period_end: periodEnd,
      })
      .eq("id", subId.data);

    if (error) return { error: "Could not update the subscription." };

    await audit(actor.id, "subscription.update", id.data, {
      subscriptionId: subId.data,
      before: {
        plan: existing.plan,
        status: existing.status,
        currentPeriodEnd: existing.current_period_end,
      },
      after: {
        plan: parsed.data.plan,
        status: parsed.data.status,
        currentPeriodEnd: periodEnd,
      },
    });
  } else {
    const { data, error } = await admin
      .from("subscriptions")
      .insert({
        user_id: id.data,
        plan: parsed.data.plan,
        status: parsed.data.status,
        current_period_end: periodEnd,
      })
      .select("id")
      .single();

    if (error || !data) return { error: "Could not create the subscription." };

    await audit(actor.id, "subscription.create", id.data, {
      subscriptionId: data.id,
      plan: parsed.data.plan,
      status: parsed.data.status,
      currentPeriodEnd: periodEnd,
    });
  }

  await syncRoleFromSubscriptions(admin, actor.id, id.data);
  revalidateUser(id.data);
  return { success: "Subscription saved." };
}

export async function cancelSubscription(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const actor = await requireAdmin();

  const userId = uuid().safeParse(formData.get("userId"));
  const subId = uuid().safeParse(formData.get("subscriptionId"));
  if (!userId.success) return { error: "Unknown user." };
  if (!subId.success) return { error: "Unknown subscription." };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("subscriptions")
    .select("*")
    .eq("id", subId.data)
    .maybeSingle();

  if (!existing || existing.user_id !== userId.data) {
    return { error: "Unknown subscription." };
  }

  const { error } = await admin
    .from("subscriptions")
    .update({ status: "cancelled" })
    .eq("id", subId.data);

  if (error) return { error: "Could not cancel the subscription." };

  await audit(actor.id, "subscription.cancel", userId.data, {
    subscriptionId: subId.data,
    plan: existing.plan,
  });

  await syncRoleFromSubscriptions(admin, actor.id, userId.data);
  revalidateUser(userId.data);
  return { success: "Subscription cancelled." };
}
