"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { uuid } from "@/lib/validation";
import type { AdminState } from "@/app/admin/subjects/actions";

/**
 * requireAdmin() is the FIRST statement of every action, outside any
 * try/catch — see app/admin/questions/actions.ts for why.
 */

export async function setMessageHandled(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown message." };
  const handled = formData.get("handled") === "true";

  const { error } = await createAdminClient()
    .from("contact_messages")
    .update({
      handled_at: handled ? new Date().toISOString() : null,
      handled_by: handled ? user.id : null,
    })
    .eq("id", id.data);

  if (error) return { error: "Could not update the message." };

  await audit(user.id, handled ? "message.handle" : "message.reopen", id.data);
  revalidatePath("/admin/messages");
  return { success: handled ? "Marked as handled." : "Reopened." };
}

export async function deleteMessage(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown message." };

  // A hard delete, unlike questions: nothing references a message, and
  // keeping someone's name and address around after we've been asked to
  // remove them is the wrong default.
  const { error } = await createAdminClient()
    .from("contact_messages")
    .delete()
    .eq("id", id.data);

  if (error) return { error: "Could not delete the message." };

  await audit(user.id, "message.delete", id.data);
  revalidatePath("/admin/messages");
  return { success: "Message deleted." };
}
