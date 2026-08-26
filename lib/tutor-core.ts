import { dailyCapWindowStart } from "@/lib/analytics-core";
import type { ExamAccess } from "@/lib/entitlements-core";
import type { UserRole } from "@/lib/supabase/types";

/**
 * AI tutor — pure rules: who may ask, how much, and what a citation is allowed
 * to say. The network call to the tutor service lives in lib/tutor.ts; the
 * proxy route (app/api/tutor/chat) wires the two together.
 */

/** Messages a trial user may ever send. Lifetime, not daily: the point is to
 * let them feel the feature, not to give them a renewing supply. Deliberately
 * separate from profiles.trials_used, which meters practice tests. */
export const TUTOR_TRIAL_ALLOWANCE = 10;
/** Messages per entitled user per Guyana day. Every one is a retrieval plus a
 * generation, so this caps spend rather than metering billing. */
export const TUTOR_DAILY_CAP = 30;

export const TUTOR_MIN_QUESTION_CHARS = 2;
/** Matches ChatRequest's max_length in the tutor service — rejecting here
 * means a 400 from us instead of a 422 the student can't act on. */
export const TUTOR_MAX_QUESTION_CHARS = 4000;

/** One message of the conversation, as rendered on load. `id` IS the
 * chat_messages row id, which is what makes answers ratable after a reload.
 * A wire type (GET /api/tutor/state) as well as a server one. */
export type TutorTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

/** UTC instant of today's Guyana midnight — the daily window's lower bound.
 * Same civil-day convention as streaks and OSCE grading; the bounds rule
 * itself lives in analytics-core (cores cross-import rather than restate). */
export function tutorCapWindowStart(now: Date): string {
  return dailyCapWindowStart(now);
}

/** Human-message guard, or null when the question is askable. */
export function validateQuestion(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < TUTOR_MIN_QUESTION_CHARS) {
    return "Type a question first.";
  }
  if (trimmed.length > TUTOR_MAX_QUESTION_CHARS) {
    return `Keep your question under ${TUTOR_MAX_QUESTION_CHARS} characters.`;
  }
  return null;
}

export type TutorDenial =
  /** Trial user out of their lifetime allowance — upsell. */
  | "trial_exhausted"
  /** No subscription and not on trial — the locked state. */
  | "no_access"
  /** Entitled, but done for today. Resets at midnight. */
  | "daily_cap";

export type TutorAccess =
  | { allowed: true; remaining: number | null; limit: number | null }
  | { allowed: false; reason: TutorDenial; message: string };

export type TutorUsage = {
  /** Questions asked ever — the trial allowance counter. */
  usedTotal: number;
  /** Questions asked since tutorCapWindowStart — the daily counter. */
  usedToday: number;
};

/**
 * Who may ask the tutor, and how much is left.
 *
 * Trial users are metered on a lifetime total and entitled users on a daily
 * window, so the two counters are never compared against the same limit.
 * Access itself is not re-derived here — ExamAccess already encodes the
 * subscription, org and grace rules (lib/entitlements-core.ts).
 */
export function tutorAccessFor(
  role: UserRole,
  access: ExamAccess,
  usage: TutorUsage
): TutorAccess {
  // Admins are unmetered: they need to be able to exercise the tutor to judge
  // answer quality, and they are not the spend risk this cap exists for.
  if (role === "admin") {
    return { allowed: true, remaining: null, limit: null };
  }

  // The org rider, read exactly as entitlements-core documents it: a non-null
  // `org` means the org grants at all. It is load-bearing twice below, because
  // `kind` alone answers neither question for a seat holder — a paying org
  // member with no personal subscription rows is `{kind:"none", org:{…}}`, and
  // an org member on a trial role is `{kind:"all", reason:"trial", org:{…}}`.
  // Their seat is paid for, so neither the trial allowance nor the lock applies.
  const orgCovered = access.org !== null;

  // examAccessFor gives trial users kind:"all" reason:"trial" — a trial is
  // full catalogue access on a credit budget, not a narrower catalogue.
  if (access.kind === "all" && access.reason === "trial" && !orgCovered) {
    const remaining = TUTOR_TRIAL_ALLOWANCE - usage.usedTotal;
    if (remaining <= 0) {
      return {
        allowed: false,
        reason: "trial_exhausted",
        message: `You've used all ${TUTOR_TRIAL_ALLOWANCE} of your free tutor questions. Subscribe to keep asking.`,
      };
    }
    return { allowed: true, remaining, limit: TUTOR_TRIAL_ALLOWANCE };
  }

  if (access.kind === "none" && !orgCovered) {
    return {
      allowed: false,
      reason: "no_access",
      message: "The AI tutor is part of a subscription.",
    };
  }

  const remaining = TUTOR_DAILY_CAP - usage.usedToday;
  if (remaining <= 0) {
    return {
      allowed: false,
      reason: "daily_cap",
      message: `You've reached today's limit of ${TUTOR_DAILY_CAP} tutor questions. It resets at midnight.`,
    };
  }
  return { allowed: true, remaining, limit: TUTOR_DAILY_CAP };
}

/** What the tutor service sends back on the `done` frame. */
export type RawCitation = {
  n: number;
  file_name: string;
  page: number | null;
  /** The source file's Google Drive URL. MUST NOT reach the browser. */
  link: string | null;
  kind: "text" | "figure" | "table";
  image_url: string | null;
};

/** What the browser is allowed to see. */
export type Citation = Omit<RawCitation, "link">;

/**
 * Drop the Drive link from a citation.
 *
 * The links point into the client's own Drive, which no student can open, and
 * the URL is a direct handle on licensed third-party material. Attribution is
 * kept — file name and page — because an uncited answer from a strict-RAG
 * tutor is worth less than no answer.
 */
export function stripCitation(c: RawCitation): Citation {
  return {
    n: c.n,
    file_name: c.file_name,
    page: c.page ?? null,
    kind: c.kind ?? "text",
    image_url: c.image_url ?? null,
  };
}

/**
 * Rewrites SSE frames on their way to the browser, dropping `link` from every
 * citation.
 *
 * Frames are re-parsed rather than passed through because a chunk boundary can
 * land anywhere — including inside the JSON of the done frame — so the buffer
 * is split on the SSE record separator and only complete records are emitted.
 *
 * A `data:` record that does not parse is DROPPED, not forwarded. That matters
 * more than it looks: when the upstream stream dies mid-frame (a Render cold
 * start drops in-flight SSE), the leftover buffer is a truncated done frame
 * whose prefix still contains a Drive URL. Forwarding it "so the client can
 * ignore it" would leak exactly what this function exists to remove — and the
 * client cannot parse a half frame anyway, so nothing is lost by dropping it.
 */
export function stripLinks(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  /** The record to emit, or null to drop it. */
  const rewrite = (record: string): string | null => {
    // Non-data lines (SSE comments, `event:`) carry no citations.
    if (!record.startsWith("data:")) return record;
    let payload: unknown;
    try {
      payload = JSON.parse(record.slice(5).trim());
    } catch {
      return null;
    }
    if (!payload || typeof payload !== "object") return null;
    const frame = payload as { citations?: unknown };
    if (!Array.isArray(frame.citations)) return record;
    return `data: ${JSON.stringify({
      ...frame,
      citations: (frame.citations as RawCitation[]).map(stripCitation),
    })}`;
  };

  const emit = (
    controller: TransformStreamDefaultController<Uint8Array>,
    record: string
  ) => {
    const rewritten = rewrite(record);
    if (rewritten !== null) {
      controller.enqueue(encoder.encode(`${rewritten}\n\n`));
    }
  };

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const records = buffer.split("\n\n");
      buffer = records.pop() ?? "";
      for (const record of records) {
        if (record) emit(controller, record);
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer.trim()) emit(controller, buffer);
    },
  });
}

// ── Floating widget (SPEC §18) ───────────────────────────────────────────────

/** The take screen: `/tests/[id]/take`. One regex, read by the app chrome
 * (which hides the nav there) and the widget (which hides the launcher there
 * unless a runner has opted in), so the two can never disagree about what
 * counts as "taking a test". */
export function isTakeRoute(pathname: string): boolean {
  return /^\/tests\/[^/]+\/take$/.test(pathname);
}

/**
 * Whether the floating launcher renders at all.
 *
 * - Unconfigured service: nothing to launch — the page renders its own
 *   "isn't switched on yet" card, so the widget stays out of the way.
 * - `/tutor` IS the maximised view; a launcher beside it would open a second
 *   view of the same conversation.
 * - Take routes are hidden by default and opted INTO by the tutor-mode runner.
 *   The default is hidden, not shown, so an exam-mode paper can never flash the
 *   launcher in the moment before its runner mounts.
 */
export function tutorLauncherVisible(input: {
  available: boolean;
  pathname: string;
  hostRegistered: boolean;
}): boolean {
  if (!input.available) return false;
  if (input.pathname === "/tutor") return false;
  if (isTakeRoute(input.pathname)) return input.hostRegistered;
  return true;
}

/** Capabilities a tutor surface may offer. `context` (phase 2) is switched on
 * by env once the tutor service accepts it; until then the button stays
 * hidden rather than sending a field the service silently ignores. */
export type TutorFeatures = { context: boolean };

/** What GET /api/tutor/state returns and the /tutor page renders from. */
export type TutorStatePayload = {
  verdict: TutorAccess;
  turns: TutorTurn[];
  features: TutorFeatures;
};

/** localStorage key for "the panel was open" — desktop only. */
export const TUTOR_WIDGET_OPEN_KEY = "cmeprep.tutor-widget.open";

/** How old a loaded transcript may be before opening the panel refetches it.
 * Measured from the last load OR the last stream settling, so a refetch never
 * races the service's asynchronous persist of a cut-off answer. */
export const TUTOR_STATE_STALE_MS = 120_000;

/** A turn as the client renders it: a history turn, or one created locally
 * while an answer streams. Local ids are prefixed `local-` and can never
 * collide with a chat_messages uuid. */
export type TranscriptTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  /** chat_messages id — only known for answers that can be rated. */
  messageId?: string;
};

/** History → transcript. Assistant turns are ratable by their row id. */
export function turnsFromHistory(turns: TutorTurn[]): TranscriptTurn[] {
  return turns.map((t) => ({
    id: t.id,
    role: t.role,
    content: t.content,
    messageId: t.role === "assistant" ? t.id : undefined,
  }));
}

/**
 * Fold a freshly fetched history into the transcript already on screen.
 *
 * The server's order and membership win: chat_messages is the record, and a
 * refetch is how questions asked on the other surface (the page, another tab)
 * appear. But `getConversation` deliberately does not reconstruct citations,
 * so a fetched turn that the client already holds keeps the client's
 * `citations`/`messageId` — otherwise every reopen would strip the sources
 * from this session's answers. Matching is by id, which is why a streamed
 * answer is re-keyed to its `message_id` on `done`.
 *
 * Local turns absent from the fetch are dropped. In practice those are the
 * `local-ask-*` user turns the server holds under its own id, and — never
 * while streaming, and only after TUTOR_STATE_STALE_MS of quiet — a cut-off
 * answer whose asynchronous persist had not landed, which the student was
 * already told to ask again.
 */
export function mergeTranscript(
  local: TranscriptTurn[],
  fetched: TutorTurn[]
): TranscriptTurn[] {
  const byId = new Map(local.map((t) => [t.id, t]));
  return turnsFromHistory(fetched).map((turn) => {
    const held = byId.get(turn.id);
    if (!held) return turn;
    return {
      ...turn,
      citations: held.citations ?? turn.citations,
      messageId: held.messageId ?? turn.messageId,
    };
  });
}
