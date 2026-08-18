"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { setCredentialName } from "@/lib/certificates";
import { credentialNameSchema, fullNameSchema } from "@/lib/validation";

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

/**
 * The name printed on CME certificates. Kept apart from full_name because
 * they are different things: full_name feeds the dashboard greeting through
 * lib/names.ts firstName(), which strips honorifics, so a certificate name
 * living there would read as "Hi, Dr.".
 *
 * Corrections are self-serve on purpose. Certificates render this live rather
 * than from a snapshot, so fixing a typo here fixes every certificate the
 * learner holds — including ones already downloaded — while the verification
 * codes stay put.
 */
export async function updateCredentialName(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const user = await requireUser();

  const parsed = credentialNameSchema.safeParse(formData.get("credentialName"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  if (!(await setCredentialName(user.id, parsed.data))) {
    return { error: "Could not update your certificate name. Try again." };
  }

  // The name appears on every certificate and gates the CME progress prompt.
  revalidatePath("/", "layout");
  return { success: "Certificate name updated." };
}
