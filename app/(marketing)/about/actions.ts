"use server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { contactSchema } from "@/lib/validation";

/**
 * The contact form on /about.
 *
 * This is the only Server Action in the app reachable without a session, so
 * it takes nothing on trust: every field goes through `contactSchema`, and the
 * write uses the service-role client because `contact_messages` grants nothing
 * to anon or authenticated. There is no direct PostgREST path to the table —
 * this action is the only door.
 *
 * Nothing is emailed. The project has no mail provider, so /admin/messages is
 * where submissions are actually read.
 */

/**
 * Non-secret fields echoed back on failure. React 19 resets an uncontrolled
 * `<form action={fn}>` as soon as the action resolves — it cannot tell an
 * error from a success — so a rejected message is lost unless the state
 * carries it back for `defaultValue`. Losing a 400-word message to a typo in
 * the email field is not a thing to make someone live with.
 */
export type ContactValues = {
  name?: string;
  email?: string;
  subject?: string;
  body?: string;
};

export type ContactState = {
  error?: string;
  success?: string;
  fieldErrors?: Partial<Record<keyof ContactValues, string>>;
  values?: ContactValues;
} | null;

export async function submitContact(
  _prev: ContactState,
  formData: FormData
): Promise<ContactState> {
  const values: ContactValues = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    subject: String(formData.get("subject") ?? ""),
    body: String(formData.get("body") ?? ""),
  };

  // Honeypot. A real visitor never sees this field, so anything in it is a
  // bot. Answer as though it worked — telling a scraper it was caught only
  // teaches it to fill the form in properly next time.
  if (String(formData.get("website") ?? "").trim() !== "") {
    return { success: "Thanks — we'll get back to you soon." };
  }

  const parsed = contactSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<keyof ContactValues, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof ContactValues | undefined;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return {
      error: "Check the highlighted fields and try again.",
      fieldErrors,
      values,
    };
  }

  // Best-effort attribution: a logged-in sender gets linked to their profile,
  // but a failure to resolve one must never block the message.
  const user = await getCurrentUser().catch(() => null);

  const { error } = await createAdminClient().from("contact_messages").insert({
    name: parsed.data.name,
    email: parsed.data.email,
    subject: parsed.data.subject,
    body: parsed.data.body,
    user_id: user?.id ?? null,
  });

  if (error) {
    return {
      error: "Could not send your message. Please try again in a moment.",
      values,
    };
  }

  // No revalidatePath: /admin/messages is a different, admin-only route and
  // nothing on this page reflects the write.
  return { success: "Thanks — we'll get back to you soon." };
}
