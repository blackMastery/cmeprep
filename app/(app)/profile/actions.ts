"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { setCredentialName } from "@/lib/certificates";
import { NOTIFICATION_CATEGORIES } from "@/lib/email-core";
import { isLanguageCode, languageByCode } from "@/lib/translation-core";
import { isLanguageEnabled } from "@/lib/translations";
import {
  credentialNameSchema,
  fullNameSchema,
  preferredLanguageSchema,
} from "@/lib/validation";

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

/**
 * The translation language new tests start with. Self-serve through the
 * RLS'd client like full_name: the column-level grant on preferred_language
 * is the enforcement. "" clears it — the select's "English only" option.
 * Must be a language the admin has switched on; a disabled one is refused
 * rather than stored, or the wizard would carry a dead default.
 */
export async function updatePreferredLanguage(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const user = await requireUser();

  const parsed = preferredLanguageSchema.safeParse(
    formData.get("preferredLanguage") ?? ""
  );
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const code = parsed.data === "" ? null : parsed.data;
  if (code !== null && !(await isLanguageEnabled(code))) {
    return { error: "That language isn't available yet." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ preferred_language: code })
    .eq("id", user.id);
  if (error) {
    return { error: "Could not update your language. Try again." };
  }

  // The wizard and the take screens read the profile through the layout.
  revalidatePath("/", "layout");
  return {
    success: code
      ? `New tests will offer ${languageByCode(code)?.nativeName ?? code} translations.`
      : "Translations turned off for new tests.",
  };
}

/**
 * "Request a language": one row per (user, language), so a second click is
 * not a second vote. A duplicate is answered as success — the student's
 * goal (it's counted) is already met. Any registry language may be asked
 * for, enabled or not; the admin page shows the counts.
 */
export async function requestLanguage(
  code: string
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!isLanguageCode(code)) return { ok: false, error: "Unknown language" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("language_requests")
    .insert({ user_id: user.id, language: code });
  // 23505 = already requested by this account.
  if (error && error.code !== "23505") {
    return { ok: false, error: "Could not send the request. Try again." };
  }
  return { ok: true };
}

/**
 * The optional email categories (notifications-plan.md). Only the toggles
 * the form actually SHOWED are written: the org-admin ones are hidden from
 * everyone else, and a hidden checkbox posts nothing, which must not read as
 * "switched off" — a member promoted to admin later would find them dark.
 * Transactional mail has no toggle and is not represented here at all.
 */
export async function updateNotificationPreferences(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const user = await requireUser();

  const patch: Record<string, boolean> = {};
  for (const category of NOTIFICATION_CATEGORIES) {
    if (!formData.has(`shown_${category}`)) continue;
    patch[category] = formData.get(category) === "on";
  }
  if (Object.keys(patch).length === 0) return { error: "Nothing to save." };

  // Admin client after requireUser (the requestLanguage precedent): the row
  // is created lazily with its unsubscribe token, which a plain RLS upsert
  // could not be granted without also exposing every column to writes.
  const admin = createAdminClient();
  const { error } = await admin
    .from("notification_preferences")
    .upsert(
      { user_id: user.id, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  if (error) {
    return { error: "Could not save your email settings. Try again." };
  }

  revalidatePath("/profile");
  return { success: "Email settings saved." };
}
