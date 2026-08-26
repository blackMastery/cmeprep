import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { SessionUser } from "@/lib/auth";
import { getExamAccess } from "@/lib/entitlements";
import type { ChatMessage } from "@/lib/supabase/types";
import {
  tutorAccessFor,
  tutorCapWindowStart,
  type Citation,
  type TutorFeatures,
  type TutorStatePayload,
  type TutorTurn,
  type TutorUsage,
} from "@/lib/tutor-core";

export type { TutorTurn } from "@/lib/tutor-core";

/**
 * Server-side wiring for the AI tutor: usage counts, conversation history and
 * the calls into the FastAPI tutor service. The rules themselves live in
 * lib/tutor-core.ts.
 *
 * Every read here uses the service-role client because the tutor tables are
 * deny-all for `authenticated` — callers must have verified the user first and
 * must scope by user.id themselves.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Messages rendered on load. Deliberately generous — the transcript is the
 * student's own record — but bounded so one long-running conversation can't
 * make the page unbounded. */
const HISTORY_LIMIT = 200;

/** Base URL of the tutor service, or null when unset. Callers render the
 * tutor as unavailable rather than falling back to localhost, which would
 * surface in production as a connection error on every question instead of a
 * legible misconfiguration. */
export function tutorApiUrl(): string | null {
  const url = process.env.TUTOR_API_URL;
  if (!url) return null;
  return url.replace(/\/+$/, "");
}

/**
 * Sent as X-Tutor-Secret.
 *
 * Blank is allowed only in development, where the tutor service usually runs
 * with no secret configured. In production a missing secret is fatal and must
 * fail HERE: the tutor service also skips its check when its own copy is
 * blank, so a half-configured pair would otherwise leave `/chat` reachable by
 * anyone holding any valid Supabase token — no entitlement, no caps, and raw
 * citations including the Drive URLs the proxy exists to strip.
 */
export function tutorSharedSecret(): string | undefined {
  const secret = process.env.TUTOR_SHARED_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error(
      "TUTOR_SHARED_SECRET is not set — refusing to call the tutor service unauthenticated"
    );
  }
  return secret || undefined;
}

export function tutorHeaders(accessToken: string): HeadersInit {
  const secret = tutorSharedSecret();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    ...(secret ? { "X-Tutor-Secret": secret } : {}),
  };
}

/**
 * The two cap counters, in one round trip each.
 *
 * Counts user messages, not assistant ones: a refusal still cost a retrieval
 * and still consumed the student's intent, and counting assistant rows would
 * let a failed stream silently refund the question. Soft under concurrency,
 * like the OSCE cap — this bounds spend, it does not meter billing.
 */
export async function getTutorUsage(
  admin: Admin,
  userId: string,
  now: Date = new Date()
): Promise<TutorUsage> {
  const [total, today] = await Promise.all([
    admin
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("role", "user"),
    admin
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("role", "user")
      .gte("created_at", tutorCapWindowStart(now)),
  ]);

  if (total.error || today.error) {
    throw new Error("could not read tutor usage");
  }
  return { usedTotal: total.count ?? 0, usedToday: today.count ?? 0 };
}

/**
 * The current conversation.
 *
 * chat_messages is append-only and never deleted, so history is bounded by the
 * tutor_threads marker rather than by a delete. Citations are deliberately not
 * reconstructed from chunk_ids: they would need a join per message, and a
 * reloaded page showing sources without the reasoning that produced them is
 * worth less than showing the answer alone.
 */
export async function getConversation(
  admin: Admin,
  userId: string
): Promise<TutorTurn[]> {
  const { data: thread } = await admin
    .from("tutor_threads")
    .select("conversation_started_at")
    .eq("user_id", userId)
    .maybeSingle();

  let query = admin
    .from("chat_messages")
    .select("id, role, content, created_at")
    .eq("user_id", userId)
    // Newest first, then reversed for display. Ascending + limit would pin the
    // transcript to the FIRST 200 rows since the marker: at 30 questions a day
    // that is reached inside a week, after which the page renders a frozen
    // conversation and nothing recent ever appears again.
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (thread?.conversation_started_at) {
    query = query.gte("created_at", thread.conversation_started_at);
  }

  const { data, error } = await query;
  if (error) throw new Error("could not read tutor conversation");

  return (data ?? [])
    .map((m: Pick<ChatMessage, "id" | "role" | "content" | "created_at">) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.created_at,
    }))
    .reverse();
}

export type TutorState = TutorStatePayload;

/** Nothing is switched on yet; phase 2 reads TUTOR_CONTEXT_ENABLED here. */
export function tutorFeatures(): TutorFeatures {
  return { context: false };
}

/**
 * Everything a tutor surface needs to render: the entitlement verdict and the
 * transcript. Shared by the /tutor page and GET /api/tutor/state so the two
 * views of one conversation cannot compute different answers.
 *
 * chat_messages and tutor_threads are deny-all for `authenticated` (the tutor
 * service writes them over a direct Postgres connection), so reads go through
 * the service-role client, scoped to this user by hand.
 */
export async function loadTutorState(user: SessionUser): Promise<TutorState> {
  const admin = createAdminClient();
  const [access, usage, turns] = await Promise.all([
    getExamAccess(user),
    getTutorUsage(admin, user.id),
    getConversation(admin, user.id),
  ]);
  return {
    verdict: tutorAccessFor(user.profile.role, access, usage),
    turns,
    features: tutorFeatures(),
  };
}

/**
 * Start a genuinely new conversation.
 *
 * Two stores have to agree: the marker this app reads history from, and the
 * LangGraph checkpointer the tutor feeds the model from. They can disagree in
 * both directions, and only one of them is recoverable:
 *
 * - Marker moved, checkpointer intact → the tutor answers using turns the
 *   student can no longer see, and nothing ever repairs it.
 * - Checkpointer cleared, marker intact → the student sees an error and stale
 *   history, but the model has genuinely forgotten. Retrying fixes it.
 *
 * So the remote clear goes first and the marker write is retried once before
 * the error surfaces, keeping the failure on the recoverable side.
 *
 * The marker is stamped by Postgres (`tutor_reset_thread`), never by this
 * server: it is compared against `chat_messages.created_at`, which Postgres
 * stamps, and a clock difference of a second either way silently hides the
 * first exchange after a reset or resurrects the previous conversation.
 */
export async function resetConversation(
  admin: Admin,
  userId: string,
  accessToken: string
): Promise<void> {
  const base = tutorApiUrl();
  if (!base) throw new Error("TUTOR_API_URL is not set");

  const res = await fetch(`${base}/chat`, {
    method: "DELETE",
    headers: tutorHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(`tutor reset failed with ${res.status}`);
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await admin.rpc("tutor_reset_thread", { p_user: userId });
    if (!error) return;
    if (attempt === 1) {
      throw new Error(`could not move the conversation boundary: ${error.message}`);
    }
  }
}

/** An SSE frame as the browser receives it, after the proxy has stripped
 * Drive links from citations. Field names are the wire names, snake_case
 * included — this is what JSON.parse hands the client, not a mapped shape. */
export type TutorFrame =
  | { token: string }
  | { done: true; citations: Citation[]; message_id?: string }
  | { error: string };
