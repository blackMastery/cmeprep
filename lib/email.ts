import "server-only";

import { after } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import {
  afterFailedAttempt,
  CATEGORY_LABEL,
  DEFAULT_PREFERENCES,
  EMAIL_BUDGET_MS,
  isEmailTemplate,
  NOTIFICATION_CATEGORIES,
  OUTBOX_BATCH,
  renderEmail,
  shouldDeliver,
  TEMPLATE_AUDIENCE,
  TEMPLATE_CATEGORY,
  type EmailPayloads,
  type EmailTemplate,
  type NotificationCategory,
  type NotificationPrefs,
} from "@/lib/email-core";
import { hasBudget } from "@/lib/reconcile-core";
import { absoluteUrl, SITE_NAME, SUPPORT_EMAIL } from "@/lib/site";
import type {
  EmailOutbox,
  NotificationPreferences,
} from "@/lib/supabase/types";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * The outbox: queue on one side, deliver on the other (notifications-plan.md).
 *
 * Nothing in the app sends mail directly. An event writes an email_outbox row
 * with a dedupe key naming the event, and that row is then delivered right
 * away — after the response, via next/server's after(), so the caller's
 * round-trip never waits on the provider. /api/cron/email runs deliverOutbox()
 * every five minutes as the SAFETY NET: rows whose immediate send failed and
 * are backing off, rows from the daily scan (which queues in bulk and leaves
 * delivery to the schedule), and anything a crashed process left behind.
 * The row-first split is what keeps the payments rule intact — money is
 * recorded and the grant written before anything here runs, and a provider
 * outage costs a delay, never a lost receipt.
 *
 * Transport is chosen by EMAIL_TRANSPORT: `log` (the default, and the only
 * option without RESEND_API_KEY) prints the rendered mail and marks the row
 * skipped, so local dev and any half-configured environment fail quiet
 * rather than loud. `resend` goes through the official SDK, mainly for its
 * idempotency-key support (see sendViaResend).
 */

// ── Queueing ────────────────────────────────────────────────

export type EnqueueInput<T extends EmailTemplate = EmailTemplate> = {
  userId: string;
  template: T;
  payload: EmailPayloads[T];
  dedupeKey: string;
};

/**
 * Queue one email. Never throws and never fails the caller: an email is a
 * consequence of an action that has already succeeded, and losing the mail
 * must not read as losing the action (same posture as audit()). Returns
 * true only when a NEW row was written — a dedupe hit is false.
 */
export async function enqueueEmail<T extends EmailTemplate>(
  admin: AdminClient,
  input: EnqueueInput<T>,
  options?: EnqueueOptions
): Promise<boolean> {
  return (await enqueueEmails(admin, [input], options)) === 1;
}

export type EnqueueOptions = {
  /**
   * Deliver the new rows as soon as the current response is sent (default
   * true). The daily scan passes false: it queues in bulk inside the cron
   * route and the five-minute job is the right place for that volume.
   */
  sendNow?: boolean;
};

const INSERT_CHUNK = 100;

/** Queue many. Chunked so a 900-member assignment is nine requests, not
 * one enormous one; each chunk ignores dedupe collisions. */
export async function enqueueEmails(
  admin: AdminClient,
  inputs: readonly EnqueueInput[],
  options?: EnqueueOptions
): Promise<number> {
  let written = 0;
  const newKeys: string[] = [];
  for (let i = 0; i < inputs.length; i += INSERT_CHUNK) {
    const chunk = inputs.slice(i, i + INSERT_CHUNK);
    try {
      const { data, error } = await admin
        .from("email_outbox")
        .upsert(
          chunk.map((input) => ({
            user_id: input.userId,
            template: input.template,
            payload: input.payload as Record<string, unknown>,
            dedupe_key: input.dedupeKey,
            // Stated on every row: postgrest-js builds one column list for
            // the whole array and would send NULL for a key some rows lack.
            scheduled_for: new Date().toISOString(),
          })),
          { onConflict: "dedupe_key", ignoreDuplicates: true }
        )
        .select("id, dedupe_key");
      if (error) throw new Error(error.message);
      written += data?.length ?? 0;
      for (const row of data ?? []) newKeys.push(row.dedupe_key);
    } catch (error) {
      console.error("email_enqueue_failed", {
        templates: [...new Set(chunk.map((c) => c.template))],
        count: chunk.length,
        error,
      });
    }
  }
  // Only rows this call actually wrote: a dedupe hit means the other path
  // already queued (and is delivering) that row.
  if ((options?.sendNow ?? true) && newKeys.length > 0) {
    scheduleImmediateDelivery(newKeys);
  }
  return written;
}

/**
 * Send freshly queued rows once the response is out. after() keeps the
 * provider round-trip off the caller's latency; outside a request scope
 * (a script, a test) it throws, and the fallback just runs the delivery
 * inline. Delivery failures never propagate — the schedule retries them.
 * Capped at OUTBOX_BATCH rows: a fan-out bigger than that sends its first
 * batch now and the rest on the next tick.
 */
function scheduleImmediateDelivery(keys: string[]): void {
  const run = () =>
    deliverOutbox({ dedupeKeys: keys.slice(0, OUTBOX_BATCH) }).catch((error) => {
      console.error("email_immediate_delivery_failed", { count: keys.length, error });
    });
  try {
    after(run);
  } catch {
    void run();
  }
}

// ── Recipients ──────────────────────────────────────────────

/** The org's admins — every org-facing template fans out to these. */
export async function orgAdminRecipients(
  admin: AdminClient,
  orgId: string,
  excludeUserId?: string | null
): Promise<string[]> {
  const { data } = await admin
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("role", "admin");
  return (data ?? [])
    .map((m) => m.user_id)
    .filter((id) => id !== excludeUserId);
}

/** Every platform admin — the audience for ops mail and role-change notices. */
export async function platformAdminRecipients(
  admin: AdminClient,
  excludeUserId?: string | null
): Promise<string[]> {
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .is("banned_at", null);
  return (data ?? []).map((p) => p.id).filter((id) => id !== excludeUserId);
}

// ── Preferences ─────────────────────────────────────────────

export function prefsOf(
  row: Pick<NotificationPreferences, (typeof NOTIFICATION_CATEGORIES)[number]> | null
): NotificationPrefs {
  if (!row) return { ...DEFAULT_PREFERENCES };
  const out = { ...DEFAULT_PREFERENCES };
  for (const c of NOTIFICATION_CATEGORIES) out[c] = row[c];
  return out;
}

/**
 * The user's preferences row, creating it with the defaults on first touch.
 * Lazy creation is what gives every account an unsubscribe token without a
 * backfill; ignoreDuplicates makes two first touches safe.
 */
export async function ensurePreferences(
  admin: AdminClient,
  userId: string
): Promise<NotificationPreferences | null> {
  const rows = await preferencesFor(admin, [userId]);
  return rows.get(userId) ?? null;
}

const IN_CHUNK = 200;

/** Preferences for many users, creating the missing rows. */
export async function preferencesFor(
  admin: AdminClient,
  userIds: readonly string[]
): Promise<Map<string, NotificationPreferences>> {
  const out = new Map<string, NotificationPreferences>();
  const ids = [...new Set(userIds)];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const { data } = await admin
      .from("notification_preferences")
      .select("*")
      .in("user_id", chunk);
    for (const row of (data ?? []) as NotificationPreferences[]) {
      out.set(row.user_id, row);
    }
    const missing = chunk.filter((id) => !out.has(id));
    if (missing.length === 0) continue;
    const { data: created } = await admin
      .from("notification_preferences")
      .upsert(
        missing.map((user_id) => ({ user_id })),
        { onConflict: "user_id", ignoreDuplicates: true }
      )
      .select("*");
    for (const row of (created ?? []) as NotificationPreferences[]) {
      out.set(row.user_id, row);
    }
    // A concurrent creator won the upsert race for some ids: read those back.
    const stillMissing = missing.filter((id) => !out.has(id));
    if (stillMissing.length > 0) {
      const { data: again } = await admin
        .from("notification_preferences")
        .select("*")
        .in("user_id", stillMissing);
      for (const row of (again ?? []) as NotificationPreferences[]) {
        out.set(row.user_id, row);
      }
    }
  }
  return out;
}

/**
 * The two unsubscribe URLs for one optional template, or null for a
 * transactional one. `page` is the footer link — a confirmation PAGE, so a
 * mail scanner that follows links cannot unsubscribe anyone. `oneClick` is
 * the List-Unsubscribe header target (app/api/unsubscribe), which acts on a
 * POST because the mail client sends that on the reader's behalf. Stated
 * once so the worker, the admin preview and the GET redirect agree.
 */
export function unsubscribeLinks(
  token: string,
  template: EmailTemplate
): { page: string; oneClick: string } | null {
  const category = TEMPLATE_CATEGORY[template];
  if (category === "transactional") return null;
  return {
    page: absoluteUrl(`/unsubscribe/${token}?category=${category}`),
    oneClick: absoluteUrl(`/api/unsubscribe?token=${token}&category=${category}`),
  };
}

/** Does a token belong to any preferences row? The unsubscribe page asks
 * this (and nothing else) before rendering its confirm button, so the page
 * itself never holds the service-role client. */
export async function unsubscribeTokenKnown(token: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("notification_preferences")
    .select("user_id")
    .eq("unsubscribe_token", token)
    .maybeSingle();
  return data !== null;
}

/**
 * Run a notification helper off the caller's response: after() when inside
 * a request (Server Function or route handler), inline otherwise. For the
 * hot paths — PayPal capture, the mid-exam report tap — where the two or
 * three lookups a helper makes should not sit in the student's round-trip.
 */
export function deferNotify(fn: () => Promise<void>): Promise<void> {
  const run = () =>
    fn().catch((error) => {
      console.error("deferred_notification_failed", { error });
    });
  try {
    after(run);
    return Promise.resolve();
  } catch {
    return run();
  }
}

/**
 * Turn one optional category off by token. Shared by the confirmation
 * page's action and the one-click route; the token is the whole credential
 * and its only power is this.
 */
export async function unsubscribeByToken(
  token: string,
  category: NotificationCategory
): Promise<{ ok: true; title: string } | { ok: false }> {
  const patch: Partial<NotificationPreferences> = {
    updated_at: new Date().toISOString(),
  };
  patch[category] = false;
  const { data, error } = await createAdminClient()
    .from("notification_preferences")
    .update(patch)
    .eq("unsubscribe_token", token)
    .select("user_id")
    .maybeSingle();
  if (error || !data) return { ok: false };
  return { ok: true, title: CATEGORY_LABEL[category].title };
}

// ── Transport ───────────────────────────────────────────────

export type Transport = "log" | "resend";

/** What the worker WOULD use, without throwing — for the admin page. */
export function emailTransportName(): Transport {
  return process.env.EMAIL_TRANSPORT === "resend" ? "resend" : "log";
}

function transport(): Transport {
  const chosen = process.env.EMAIL_TRANSPORT;
  if (chosen === "resend") {
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
      // Deployment misconfiguration, not weather — say so rather than
      // silently logging mail that production expected to send.
      throw new Error("EMAIL_TRANSPORT=resend needs RESEND_API_KEY and EMAIL_FROM");
    }
    return "resend";
  }
  return "log";
}

/** A student is not waiting on this, but the worker's budget is: past this
 * the row backs off and the next tick retries. */
const SEND_TIMEOUT_MS = 15_000;

type SendResult = { ok: true; id: string | null } | { ok: false; error: string };

/** One client per process; created on first send so a log-transport
 * environment never touches the key. */
let resendClient: Resend | null = null;
function resend(): Resend {
  resendClient ??= new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

/** Resend accepts 1–256 characters; every dedupeKey builder stays well
 * inside that, but a payload-derived key must never be silently cut (a
 * truncated key could collide with another row's). */
const IDEMPOTENCY_KEY_MAX = 256;

async function sendViaResend(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  oneClickUrl: string | null;
  /**
   * The row's dedupe key. Resend honours it for 24 hours, which closes the
   * one duplicate path the outbox claim cannot: a send that reached Resend
   * but whose `sent` write never landed (route killed, deploy mid-tick) is
   * retried with the same key and Resend returns the original message
   * instead of a second delivery.
   */
  idempotencyKey: string;
}): Promise<SendResult> {
  const from = process.env.EMAIL_FROM!;
  const headers: Record<string, string> = {};
  if (input.oneClickUrl) {
    // RFC 8058 one-click: mail clients surface their own "unsubscribe"
    // button from these, which keeps optional mail out of the spam folder.
    headers["List-Unsubscribe"] = `<${input.oneClickUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  const options =
    input.idempotencyKey.length <= IDEMPOTENCY_KEY_MAX
      ? { idempotencyKey: input.idempotencyKey }
      : undefined;

  // The SDK reports API failures as `error`, not by throwing; the race is
  // for a hung connection, which it does not time out on its own. The timer
  // is cleared in `finally` so a fast send does not leave a live handle
  // that keeps the invocation alive for 15s on hosts that drain the loop.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${SEND_TIMEOUT_MS}ms`)),
        SEND_TIMEOUT_MS
      );
    });
    const { data, error } = await Promise.race([
      resend().emails.send(
        {
          from: `${SITE_NAME} <${from}>`,
          to: [input.to],
          replyTo: SUPPORT_EMAIL,
          subject: input.subject,
          html: input.html,
          text: input.text,
          headers,
        },
        options
      ),
      timeout,
    ]);
    if (error) {
      return {
        ok: false,
        error: `resend_${error.name}: ${error.message}`.slice(0, 500),
      };
    }
    return { ok: true, id: data?.id ?? null };
  } catch (error) {
    return {
      ok: false,
      error: `resend_request_failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Delivery ────────────────────────────────────────────────

export type DeliverySummary = {
  durationMs: number;
  transport: Transport;
  scanned: number;
  sent: number;
  skipped: number;
  /** Failed this run but will retry. */
  retried: number;
  /** Parked at MAX_SEND_ATTEMPTS, for a human. */
  failed: number;
  truncated: boolean;
};

/**
 * Deliver due rows, oldest first, within the time budget.
 *
 * Each row is CLAIMED before sending — attempts+1 pinned on the attempts
 * value just read — so two overlapping runs cannot both send it. A crash
 * between claim and outcome leaves the row queued with one more attempt,
 * which the next run retries; at the cap it is parked instead.
 */
export async function deliverOutbox(options?: {
  budgetMs?: number;
  /**
   * Deliver these rows now (immediate delivery after an event, the admin
   * test-send), leaving the rest of the queue to the schedule. Ignores
   * scheduled_for and writes no audit row — the schedule's runs are the
   * heartbeat, and one row per event would drown the log.
   */
  dedupeKeys?: readonly string[];
  /**
   * Who is running the queue. Only `schedule` writes the email.deliver
   * audit row: that row is what /admin/emails reads as "the cron is alive",
   * and a hand-run from the same page must not forge that heartbeat.
   */
  source?: "schedule" | "manual";
}): Promise<DeliverySummary> {
  const startedAt = Date.now();
  const deadline = startedAt + (options?.budgetMs ?? EMAIL_BUDGET_MS);
  const admin = createAdminClient();
  const mode = transport();
  const summary: DeliverySummary = {
    durationMs: 0,
    transport: mode,
    scanned: 0,
    sent: 0,
    skipped: 0,
    retried: 0,
    failed: 0,
    truncated: false,
  };

  let query = admin
    .from("email_outbox")
    .select("*")
    .eq("status", "queued")
    .order("scheduled_for", { ascending: true })
    .limit(OUTBOX_BATCH);
  query = options?.dedupeKeys
    ? query.in("dedupe_key", [...options.dedupeKeys])
    : query.lte("scheduled_for", new Date().toISOString());
  const { data: rows, error } = await query;
  if (error) {
    console.error("email_outbox_scan_failed", { error });
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }
  const queue = (rows ?? []) as EmailOutbox[];
  if (queue.length === 0) {
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  const userIds = [...new Set(queue.map((r) => r.user_id))];
  const [{ data: emailRows }, prefs] = await Promise.all([
    admin.from("user_emails").select("id, email, confirmed").in("id", userIds),
    preferencesFor(admin, userIds),
  ]);
  const emailById = new Map(
    (emailRows ?? []).map((r) => [r.id, { email: r.email, confirmed: r.confirmed }])
  );
  // Audience re-check (TEMPLATE_AUDIENCE): rows are addressed at enqueue
  // time, and a demotion, an org removal or a ban between then and now (or
  // before a Retry weeks later) must not deliver contact-form PII, queue
  // figures or other members' names and scores to someone who no longer
  // holds the role they were addressed as.
  const audiences = queue.map((r) =>
    isEmailTemplate(r.template) ? TEMPLATE_AUDIENCE[r.template] : "user"
  );
  const currentAdmins = audiences.includes("platform_admin")
    ? new Set(await platformAdminRecipients(admin))
    : new Set<string>();
  const orgAdminPairs = new Set<string>();
  const orgUserIds = [
    ...new Set(
      queue.filter((_, i) => audiences[i] === "org_admin").map((r) => r.user_id)
    ),
  ];
  if (orgUserIds.length > 0) {
    const { data } = await admin
      .from("org_members")
      .select("org_id, user_id")
      .eq("role", "admin")
      .in("user_id", orgUserIds);
    for (const m of data ?? []) orgAdminPairs.add(`${m.org_id}:${m.user_id}`);
  }

  for (const row of queue) {
    // Reserve a full send's worth: a row claimed at the edge of the budget
    // whose provider call outlives the route would be re-sent next tick —
    // the one duplicate path the claim cannot close.
    if (!hasBudget(deadline - SEND_TIMEOUT_MS, Date.now())) {
      summary.truncated = true;
      break;
    }
    summary.scanned += 1;
    const now = new Date();

    // Claim. Zero rows back = another run got here first; leave it to them.
    const { data: claimed } = await admin
      .from("email_outbox")
      .update({ attempts: row.attempts + 1, updated_at: now.toISOString() })
      .eq("id", row.id)
      .eq("status", "queued")
      .eq("attempts", row.attempts)
      .select("id");
    if (!claimed || claimed.length === 0) continue;
    const attempts = row.attempts + 1;

    const skip = async (reason: string) => {
      summary.skipped += 1;
      await admin
        .from("email_outbox")
        .update({
          status: "skipped",
          skip_reason: reason,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    };

    const recipient = emailById.get(row.user_id);
    if (!recipient?.email || !recipient.confirmed) {
      await skip("no_confirmed_email");
      continue;
    }
    if (!isEmailTemplate(row.template)) {
      await skip("unknown_template");
      continue;
    }
    const template = row.template;
    const pref = prefs.get(row.user_id) ?? null;
    if (!shouldDeliver(template, prefsOf(pref))) {
      await skip("preference");
      continue;
    }
    const audience = TEMPLATE_AUDIENCE[template];
    if (audience === "platform_admin" && !currentAdmins.has(row.user_id)) {
      await skip("not_admin");
      continue;
    }
    if (audience === "org_admin") {
      const orgId = (row.payload as { orgId?: unknown }).orgId;
      if (typeof orgId !== "string" || !orgAdminPairs.has(`${orgId}:${row.user_id}`)) {
        await skip("not_org_admin");
        continue;
      }
    }

    const links = pref ? unsubscribeLinks(pref.unsubscribe_token, template) : null;
    const unsubscribeUrl = links?.page ?? null;
    const oneClickUrl = links?.oneClick ?? null;
    let rendered;
    try {
      rendered = renderEmail(
        template,
        row.payload as EmailPayloads[typeof template],
        { unsubscribeUrl }
      );
    } catch (error) {
      // A payload the template cannot render will never render; park it.
      summary.failed += 1;
      await admin
        .from("email_outbox")
        .update({
          status: "failed",
          last_error: `render_failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      continue;
    }

    if (mode === "log") {
      console.info("email_log_transport", {
        to: recipient.email,
        template,
        subject: rendered.subject,
        text: rendered.text,
      });
      await skip("log_transport");
      continue;
    }

    const result = await sendViaResend({
      to: recipient.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      oneClickUrl,
      idempotencyKey: row.dedupe_key,
    });
    if (result.ok) {
      summary.sent += 1;
      await admin
        .from("email_outbox")
        .update({
          status: "sent",
          provider_id: result.id,
          sent_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      continue;
    }

    const next = afterFailedAttempt(attempts, new Date());
    if (next.status === "failed") summary.failed += 1;
    else summary.retried += 1;
    console.error("email_send_failed", {
      id: row.id,
      template,
      attempts,
      parked: next.status === "failed",
      error: result.error,
    });
    await admin
      .from("email_outbox")
      .update({
        status: next.status,
        scheduled_for: next.scheduledFor,
        last_error: result.error,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  }

  summary.durationMs = Date.now() - startedAt;
  // Scheduled runs only, and only when there was work: a heartbeat every
  // five minutes would be 288 rows a day of nothing, and immediate sends
  // would be one row per event. The scan job is the daily heartbeat.
  if (
    !options?.dedupeKeys &&
    (options?.source ?? "schedule") === "schedule" &&
    summary.scanned > 0
  ) {
    await audit(null, "email.deliver", null, { ...summary });
  }
  return summary;
}
