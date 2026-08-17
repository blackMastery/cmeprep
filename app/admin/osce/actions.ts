"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/admin/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuid } from "@/lib/validation";

/**
 * Mark an OSCE grade report handled. requireAdmin() first statement, outside
 * any try/catch — layouts never gate actions.
 */
export async function markReportHandled(formData: FormData): Promise<void> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return;

  const admin = createAdminClient();
  const { data } = await admin
    .from("osce_grade_reports")
    .update({ handled_at: new Date().toISOString(), handled_by: user.id })
    .eq("id", id.data)
    .is("handled_at", null)
    .select("id")
    .maybeSingle();

  // Already handled by someone else: their audit row tells the story.
  if (data) {
    await audit(user.id, "osce.report_handle", id.data);
  }
  revalidatePath("/admin/osce/reports");
}
