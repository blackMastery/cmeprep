"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fullNameSchema } from "@/lib/validation";

export type ProfileState = { error?: string; success?: string } | null;

export async function updateProfileName(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  // First statement, outside any try/catch: layouts do not gate Server
  // Actions, and requireUser throws NEXT_REDIRECT (incl. banned → /banned).
  const user = await requireUser();

  const parsed = fullNameSchema.safeParse(formData.get("fullName"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // RLS'd client on purpose: the column-level grant lets authenticated users
  // update ONLY full_name on their own row — the payload must contain
  // nothing else, and the DB (not this code) is the enforcement.
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data })
    .eq("id", user.id);

  if (error) {
    return { error: "Could not update your name. Try again." };
  }

  // Name shows in the header dropdown and dashboard greeting.
  revalidatePath("/", "layout");
  return { success: "Name updated." };
}
