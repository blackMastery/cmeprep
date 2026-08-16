"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { guyanaDay, mondayOf } from "@/lib/orgs-core";
import {
  planGoalsDocSchema,
  planIntensityUpdateSchema,
  planSittingSchema,
  uuid,
} from "@/lib/validation";

/**
 * Every action calls requireUser() as its FIRST statement, outside any
 * try/catch — layouts do not protect Server Actions, and the guard signals
 * by throwing NEXT_REDIRECT, which a catch would swallow.
 *
 * Settings rows are own-row RLS'd, so these writes need no entitlement
 * check: a settings row for an exam the caller can't practise changes
 * nothing — /plan never renders it.
 */

export type PlanActionState = { error?: string; success?: string } | null;

export async function setIntensityAction(
  _prev: PlanActionState,
  formData: FormData
): Promise<PlanActionState> {
  const user = await requireUser();

  const parsed = planIntensityUpdateSchema.safeParse({
    examId: String(formData.get("examId") ?? ""),
    intensity: String(formData.get("intensity") ?? ""),
  });
  if (!parsed.success) return { error: "Pick an intensity." };

  const supabase = await createClient();
  const { error } = await supabase.from("study_plan_settings").upsert(
    {
      user_id: user.id,
      exam_id: parsed.data.examId,
      intensity: parsed.data.intensity,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,exam_id" }
  );
  if (error) return { error: "Could not save. Try again." };

  revalidatePath("/plan");
  // This week's goals are frozen by design — say so, or the unchanged
  // targets read as a silent failure.
  return { success: "Saved — applies from next week's plan." };
}

export async function setSittingDateAction(
  _prev: PlanActionState,
  formData: FormData
): Promise<PlanActionState> {
  const user = await requireUser();

  // "" = clear the personal date (fall back to the org's, if any). Mapped
  // BEFORE parsing, per the coerce convention in lib/validation.ts.
  const raw = String(formData.get("sittingOn") ?? "");
  const parsed = planSittingSchema.safeParse({
    examId: String(formData.get("examId") ?? ""),
    sittingOn: raw === "" ? null : raw,
  });
  if (!parsed.success) return { error: "Pick a valid date." };

  const supabase = await createClient();
  const { error } = await supabase.from("study_plan_settings").upsert(
    {
      user_id: user.id,
      exam_id: parsed.data.examId,
      sitting_on: parsed.data.sittingOn,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,exam_id" }
  );
  if (error) return { error: "Could not save. Try again." };

  revalidatePath("/plan");
  return {
    success:
      parsed.data.sittingOn === null
        ? "Exam date cleared."
        : "Exam date saved — your plan will pace toward it.",
  };
}

/**
 * Dismiss the cold-start diagnostic. Also regenerates THIS week: the frozen-
 * week rule exists to stop goals drifting under a student's feet, but this
 * is the student explicitly rejecting the week's headline goal — leaving a
 * dismissed diagnostic on screen for six more days would be worse. The
 * delete runs on the admin client (weeks have no delete policy) with the
 * caller's own id as the filter; requireUser above makes that safe.
 */
export async function dismissDiagnosticAction(
  _prev: PlanActionState,
  formData: FormData
): Promise<PlanActionState> {
  const user = await requireUser();

  const examId = uuid().safeParse(String(formData.get("examId") ?? ""));
  if (!examId.success) return { error: "Something went wrong. Reload the page." };

  const supabase = await createClient();
  const { error } = await supabase.from("study_plan_settings").upsert(
    {
      user_id: user.id,
      exam_id: examId.data,
      diagnostic_dismissed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,exam_id" }
  );
  if (error) return { error: "Could not save. Try again." };

  // Known small race: a concurrent /plan render that read settings BEFORE
  // the upsert above can regenerate a diagnostic week after this delete.
  // Self-correcting (Skip again deletes it) and rare enough to accept in v1.
  const weekStart = mondayOf(guyanaDay(new Date()));
  const admin = createAdminClient();
  const { data: weekRow } = await admin
    .from("study_plan_weeks")
    .select("id, goals")
    .eq("user_id", user.id)
    .eq("exam_id", examId.data)
    .eq("week_start", weekStart)
    .maybeSingle();
  // Only a week whose headline actually IS the diagnostic gets regenerated —
  // never delete a week of real goals.
  const doc = weekRow ? planGoalsDocSchema.safeParse(weekRow.goals) : null;
  if (
    weekRow &&
    doc?.success &&
    doc.data.goals.some((g) => g.type === "mock" && g.diagnostic)
  ) {
    await admin.from("study_plan_weeks").delete().eq("id", weekRow.id);
    // RLS-bypassing delete — leave a trail (all admin-client mutations do).
    await audit(user.id, "study_plan.dismiss_diagnostic", user.id, {
      examId: examId.data,
      weekStart,
    });
  }

  revalidatePath("/plan");
  return { success: "Diagnostic skipped — here's a regular week instead." };
}
