import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { ContactMessage } from "@/lib/supabase/types";

export const MESSAGES_PAGE_SIZE = 25;

export type MessageFilter = "unhandled" | "handled" | "all";

export async function listMessages(options: {
  filter?: MessageFilter;
  page?: number;
}): Promise<{
  rows: ContactMessage[];
  total: number;
  page: number;
  pageCount: number;
  unhandled: number;
}> {
  const admin = createAdminClient();
  const filter = options.filter ?? "unhandled";
  const page = Math.max(1, options.page ?? 1);
  const from = (page - 1) * MESSAGES_PAGE_SIZE;

  let query = admin
    .from("contact_messages")
    .select("*", { count: "exact" })
    // Matches contact_messages_triage_idx: open messages first, newest first
    // within each group.
    .order("handled_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .range(from, from + MESSAGES_PAGE_SIZE - 1);

  if (filter === "unhandled") query = query.is("handled_at", null);
  else if (filter === "handled") query = query.not("handled_at", "is", null);

  // The unhandled count drives the sidebar badge, so it is always the total
  // across every page rather than what this page happens to show.
  const [{ data, count }, { count: unhandled }] = await Promise.all([
    query,
    admin
      .from("contact_messages")
      .select("id", { count: "exact", head: true })
      .is("handled_at", null),
  ]);

  const total = count ?? 0;

  return {
    rows: (data ?? []) as ContactMessage[],
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / MESSAGES_PAGE_SIZE)),
    unhandled: unhandled ?? 0,
  };
}

/** Unhandled count on its own, for the sidebar badge. */
export async function unhandledMessageCount(): Promise<number> {
  const { count } = await createAdminClient()
    .from("contact_messages")
    .select("id", { count: "exact", head: true })
    .is("handled_at", null);

  return count ?? 0;
}
