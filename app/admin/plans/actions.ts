"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { nextPosition } from "@/lib/admin/taxonomy";
import { parseFeatureLines, planSchema, uuid } from "@/lib/validation";
import type { Plan } from "@/lib/supabase/types";
import type { AdminState } from "@/app/admin/subjects/actions";

const UNIQUE_VIOLATION = "23505";

/**
 * Every action calls requireAdmin() as its FIRST statement, outside any
 * try/catch — the admin layout does not protect Server Actions.
 */

function revalidatePlans() {
  revalidatePath("/admin/plans");
  // Plans render on the public pricing section and the trial-limit card.
  revalidatePath("/");
  revalidatePath("/tests/new");
}

type ParsedPlan = {
  name: string;
  price_cents: number;
  period: string;
  description: string | null;
  duration_months: number | null;
  features: string[];
  featured: boolean;
  is_active: boolean;
};

function parsePlanForm(formData: FormData):
  | { ok: true; plan: ParsedPlan }
  | { ok: false; error: string } {
  // "" must become null BEFORE zod — coerce would turn it into 0.
  const rawDuration = String(formData.get("durationMonths") ?? "").trim();

  const parsed = planSchema.safeParse({
    name: formData.get("name"),
    priceDollars: formData.get("priceDollars"),
    period: formData.get("period"),
    description: String(formData.get("description") ?? ""),
    durationMonths: rawDuration === "" ? null : rawDuration,
    features: parseFeatureLines(String(formData.get("features") ?? "")),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  return {
    ok: true,
    plan: {
      name: parsed.data.name,
      price_cents: Math.round(parsed.data.priceDollars * 100),
      period: parsed.data.period,
      description: parsed.data.description === "" ? null : parsed.data.description,
      duration_months: parsed.data.durationMonths,
      features: parsed.data.features,
      featured: formData.get("featured") === "on",
      is_active: formData.get("isActive") === "on",
    },
  };
}

/**
 * The marketing section highlights ONE plan. Two admins racing this is a
 * last-write-wins on an admin-only surface — acceptable, no transaction.
 */
async function sweepFeatured(
  admin: ReturnType<typeof createAdminClient>,
  keepId: string
) {
  await admin.from("plans").update({ featured: false }).neq("id", keepId);
}

export async function createPlan(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const parsed = parsePlanForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  const admin = createAdminClient();
  const { data: existing } = await admin.from("plans").select("position");

  const { data, error } = await admin
    .from("plans")
    .insert({ ...parsed.plan, position: nextPosition(existing ?? []) })
    .select("id")
    .single();

  if (error) {
    return {
      error:
        error.code === UNIQUE_VIOLATION
          ? "A plan with that name already exists."
          : "Could not create the plan.",
    };
  }

  if (parsed.plan.featured) await sweepFeatured(admin, data.id);

  await audit(user.id, "plan.create", data.id, {
    name: parsed.plan.name,
    priceCents: parsed.plan.price_cents,
  });
  revalidatePlans();
  return { success: `Created ${parsed.plan.name}.` };
}

export async function updatePlan(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown plan." };

  const parsed = parsePlanForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("plans")
    .select("*")
    .eq("id", id.data)
    .maybeSingle();
  if (!before) return { error: "Unknown plan." };

  const { error } = await admin
    .from("plans")
    .update({ ...parsed.plan, updated_at: new Date().toISOString() })
    .eq("id", id.data);

  if (error) {
    return {
      error:
        error.code === UNIQUE_VIOLATION
          ? "A plan with that name already exists."
          : "Could not update the plan.",
    };
  }

  if (parsed.plan.featured) await sweepFeatured(admin, id.data);

  const prior = before as Plan;
  await audit(user.id, "plan.update", id.data, {
    before: {
      name: prior.name,
      priceCents: prior.price_cents,
      featured: prior.featured,
      isActive: prior.is_active,
    },
    after: {
      name: parsed.plan.name,
      priceCents: parsed.plan.price_cents,
      featured: parsed.plan.featured,
      isActive: parsed.plan.is_active,
    },
  });
  revalidatePlans();
  return { success: "Plan saved." };
}

export async function deletePlan(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown plan." };

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("plans")
    .select("name")
    .eq("id", id.data)
    .maybeSingle();
  if (!before) return { error: "Unknown plan." };

  // Hard delete is safe: subscriptions.plan stores a TEXT snapshot, so
  // history never dangles. The confirm dialog steers admins to deactivate
  // instead when the plan was ever sold.
  const { error } = await admin.from("plans").delete().eq("id", id.data);
  if (error) return { error: "Could not delete the plan." };

  await audit(user.id, "plan.delete", id.data, { name: before.name });
  revalidatePlans();
  return { success: "Plan deleted." };
}

/** Swap position with the neighbour — single-table clone of `reorder`. */
export async function reorderPlans(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  const direction = formData.get("direction") === "up" ? "up" : "down";
  if (!id.success) return { error: "Unknown plan." };

  const admin = createAdminClient();
  const { data } = await admin.from("plans").select("id, name, position");
  const siblings = data ?? [];

  const ordered = [...siblings].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name)
  );
  const index = ordered.findIndex((p) => p.id === id.data);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= ordered.length) {
    return { success: "Already at the end." };
  }

  const reordered = [...ordered];
  [reordered[index], reordered[swapWith]] = [
    reordered[swapWith],
    reordered[index],
  ];

  await Promise.all(
    reordered.map((p, position) =>
      admin.from("plans").update({ position }).eq("id", p.id)
    )
  );

  await audit(user.id, "plan.reorder", id.data, { direction });
  revalidatePlans();
  return { success: "Reordered." };
}
