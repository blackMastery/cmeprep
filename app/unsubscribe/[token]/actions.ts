"use server";

import { isNotificationCategory } from "@/lib/email-core";
import { unsubscribeByToken } from "@/lib/email";
import { uuid } from "@/lib/validation";

export type UnsubscribeState = { error?: string; success?: string } | null;

/**
 * The confirm button on /unsubscribe/[token]. No session, on purpose: the
 * token in the link IS the credential, and the only thing it can do is turn
 * one optional category OFF. The page renders a button rather than acting on
 * the GET so a mail scanner that follows links cannot unsubscribe anyone.
 */
export async function unsubscribe(
  _prev: UnsubscribeState,
  formData: FormData
): Promise<UnsubscribeState> {
  const token = uuid().safeParse(formData.get("token"));
  const category = formData.get("category");
  if (!token.success || !isNotificationCategory(category)) {
    return { error: "This link is not valid." };
  }
  const result = await unsubscribeByToken(token.data, category);
  if (!result.ok) return { error: "This link is no longer valid." };
  return {
    success: `Done — you won't receive "${result.title}" emails any more.`,
  };
}
