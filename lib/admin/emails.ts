import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  emailTransportName,
  enqueueEmail,
  preferencesFor,
  prefsOf,
  type Transport,
} from "@/lib/email";
import { dedupeKey, shouldDeliver, type EmailTemplate } from "@/lib/email-core";
import { EMAIL_SAMPLES } from "@/lib/email-samples";
import type { EmailOutbox, EmailOutboxStatus } from "@/lib/supabase/types";

/**
 * Reads and the two writes behind /admin/emails: the outbox monitor and the
 * template tester. Service-role throughout — the caller is an admin page or
 * an admin Server Action that has already run requireAdmin().
 */

export const OUTBOX_PAGE_SIZE = 50;

export const OUTBOX_FILTERS = ["all", "queued", "sent", "failed", "skipped"] as const;
export type OutboxFilter = (typeof OUTBOX_FILTERS)[number];

export function isOutboxFilter(value: unknown): value is OutboxFilter {
  return (
    typeof value === "string" && (OUTBOX_FILTERS as readonly string[]).includes(value)
  );
}

export type EmailRun = { at: string; meta: Record<string, unknown> | null };

export type EmailOverview = {
  transport: Transport;
  /** Due now — what the next deliver tick will pick up. */
  queuedDue: number;
  /** Scheduled for later (a backoff retry). */
  queuedLater: number;
  sent7d: number;
  skipped7d: number;
  /** Parked at the attempt cap, all time — these need a human. */
  failed: number;
  lastScan: EmailRun | null;
  lastDeliver: EmailRun | null;
};

const DAY_MS = 86_400_000;

async function lastRun(action: "email.scan" | "email.deliver"): Promise<EmailRun | null> {
  const { data } = await createAdminClient()
    .from("audit_logs")
    .select("created_at, meta")
    .eq("action", action)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { at: data.created_at, meta: data.meta } : null;
}

export async function getEmailOverview(now: Date = new Date()): Promise<EmailOverview> {
  const admin = createAdminClient();
  const nowIso = now.toISOString();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const head = (status: EmailOutboxStatus) =>
    admin.from("email_outbox").select("id", { count: "exact", head: true }).eq("status", status);

  const [
    { count: queuedDue },
    { count: queuedLater },
    { count: sent7d },
    { count: skipped7d },
    { count: failed },
    lastScan,
    lastDeliver,
  ] = await Promise.all([
    head("queued").lte("scheduled_for", nowIso),
    head("queued").gt("scheduled_for", nowIso),
    // sent_at, not created_at: a row queued last week and retried today
    // was sent today, which is what the tile says.
    head("sent").gte("sent_at", weekAgo),
    head("skipped").gte("created_at", weekAgo),
    head("failed"),
    lastRun("email.scan"),
    lastRun("email.deliver"),
  ]);

  return {
    transport: emailTransportName(),
    queuedDue: queuedDue ?? 0,
    queuedLater: queuedLater ?? 0,
    sent7d: sent7d ?? 0,
    skipped7d: skipped7d ?? 0,
    failed: failed ?? 0,
    lastScan,
    lastDeliver,
  };
}

/** The table's row: the outbox minus `payload` (contact-form bodies, PayPal
 * ids — nothing the table renders, and EmailsTable is a client component,
 * so it would otherwise all be serialised to the browser). */
export type OutboxRow = Omit<EmailOutbox, "payload"> & {
  email: string | null;
  userName: string | null;
};

const OUTBOX_COLUMNS =
  "id, user_id, template, dedupe_key, status, attempts, last_error, skip_reason, provider_id, scheduled_for, sent_at, created_at, updated_at";

/** Newest first, one status or all, with the recipient resolved. */
export async function listOutbox(options: {
  filter: OutboxFilter;
  page: number;
}): Promise<{ rows: OutboxRow[]; page: number; pageCount: number; total: number }> {
  const admin = createAdminClient();
  const requested = Number.isFinite(options.page)
    ? Math.max(1, Math.floor(options.page))
    : 1;

  // Count first (a head request, the idiomatic shape): PostgREST answers a
  // range past the end with 416 when a count is requested, so a stale
  // "Next" link (or ?page=999) would 500 the page. Clamp instead.
  const countQuery = admin
    .from("email_outbox")
    .select("id", { count: "exact", head: true });
  const { count, error: countError } = await (options.filter === "all"
    ? countQuery
    : countQuery.eq("status", options.filter));
  if (countError) throw new Error(`could not read the outbox: ${countError.message}`);
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / OUTBOX_PAGE_SIZE));
  const page = Math.min(requested, pageCount);
  const from = (page - 1) * OUTBOX_PAGE_SIZE;

  const listQuery = admin.from("email_outbox").select(OUTBOX_COLUMNS);
  const { data, error } = await (options.filter === "all"
    ? listQuery
    : listQuery.eq("status", options.filter))
    .order("created_at", { ascending: false })
    // A fan-out is one upsert, so its rows share one created_at; without a
    // unique tiebreak OFFSET paging can drop or repeat rows at a boundary.
    .order("id", { ascending: false })
    .range(from, from + OUTBOX_PAGE_SIZE - 1);
  if (error) throw new Error(`could not read the outbox: ${error.message}`);
  const rows = (data ?? []) as Omit<EmailOutbox, "payload">[];

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const [{ data: emails }, { data: profiles }] =
    userIds.length === 0
      ? [{ data: [] }, { data: [] }]
      : await Promise.all([
          admin.from("user_emails").select("id, email").in("id", userIds),
          admin.from("profiles").select("id, full_name").in("id", userIds),
        ]);
  const emailById = new Map((emails ?? []).map((e) => [e.id, e.email]));
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return {
    rows: rows.map((row) => ({
      ...row,
      email: emailById.get(row.user_id) ?? null,
      userName: nameById.get(row.user_id) ?? null,
    })),
    page,
    pageCount,
    total,
  };
}

/**
 * Put a parked or skipped row back in the queue with a clean attempt count.
 * Skipped rows are retryable too: "no confirmed email" clears once the
 * address is verified, and a log-transport skip is the local-dev norm.
 * Sent rows are not — a receipt does not go twice from a misclick.
 */
export async function retryOutboxRow(id: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("email_outbox")
    .update({
      status: "queued",
      attempts: 0,
      last_error: null,
      skip_reason: null,
      scheduled_for: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .in("status", ["failed", "skipped"])
    .select("id");
  return !error && (data?.length ?? 0) > 0;
}

/**
 * Queue one template's sample payload to an admin's own address. Every
 * press is a fresh row on purpose — the whole point is to see it arrive.
 *
 * The worker applies the recipient's OWN toggles to every row, test rows
 * included (weekly_digest is off by default), so the refusal happens here,
 * before a row exists, rather than as a silent "skipped / preference".
 */
export async function queueTestEmail(
  userId: string,
  template: EmailTemplate
): Promise<
  | { outcome: "queued"; dedupeKey: string }
  | { outcome: "preference_off" }
  | { outcome: "failed" }
> {
  const admin = createAdminClient();
  const prefs = await preferencesFor(admin, [userId]);
  if (!shouldDeliver(template, prefsOf(prefs.get(userId) ?? null))) {
    return { outcome: "preference_off" };
  }
  const key = dedupeKey.test(template, userId, new Date().toISOString());
  // sendNow off: the action delivers this row itself, synchronously, so it
  // can report the outcome; a second after() attempt would only race it.
  const ok = await enqueueEmail(
    admin,
    { userId, template, payload: EMAIL_SAMPLES[template], dedupeKey: key },
    { sendNow: false }
  );
  return ok ? { outcome: "queued", dedupeKey: key } : { outcome: "failed" };
}

/** The row a test-send produced, after its immediate delivery attempt. */
export async function testEmailOutcome(
  key: string
): Promise<Pick<EmailOutbox, "status" | "skip_reason" | "last_error"> | null> {
  const { data } = await createAdminClient()
    .from("email_outbox")
    .select("status, skip_reason, last_error")
    .eq("dedupe_key", key)
    .maybeSingle();
  return data ?? null;
}
