import "server-only";

import { parseVerdict, type JudgeMessage } from "@/lib/osce-grading-core";

/**
 * Minimal OpenAI client for OSCE grading over plain fetch — no vendor SDK
 * (lib/paypal.ts precedent). One call shape: judge a student's free-text
 * answer against a model answer and return a binary verdict.
 */

const API_URL = "https://api.openai.com/v1/chat/completions";

/** gpt-5-mini: cheap + fast enough for a student waiting on reveal, and the
 * binary judge-vs-model-answer task is well within it. Swappable via env. */
const DEFAULT_MODEL = "gpt-5-mini";

/** The gpt-5 family are reasoning models: budget covers reasoning tokens too,
 * so this is deliberately roomy for a one-word JSON verdict. */
const MAX_COMPLETION_TOKENS = 1000;

/** A student is waiting on this; past ~20s a retry beats hanging. */
const TIMEOUT_MS = 20_000;

export function osceModel(): string {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

/** The subset of the chat-completions response this app reads. */
type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

export type JudgeResult =
  | {
      ok: true;
      verdict: "correct" | "incorrect";
      model: string;
      promptTokens: number | null;
      completionTokens: number | null;
      durationMs: number;
      raw: Record<string, unknown> | null;
    }
  | {
      ok: false;
      /** Short machine-ish detail for the grading-events log, never the UI. */
      error: string;
      model: string;
      durationMs: number;
      raw: Record<string, unknown> | null;
    };

/**
 * One judge call. Never throws on API failure — every outcome (including a
 * malformed reply, which parseVerdict maps to null) comes back as `ok: false`
 * so the route can log the event and tell the student to retry. Only a
 * missing key throws: that is deployment misconfiguration, not weather.
 */
export async function judgeAnswer(messages: JudgeMessage[]): Promise<JudgeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const model = osceModel();
  const started = Date.now();

  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        // NOT max_tokens — deprecated for the reasoning-model families.
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        // Grading is a comparison, not a derivation; low keeps reveal fast.
        reasoning_effort: "low",
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "osce_verdict",
            strict: true,
            schema: {
              type: "object",
              properties: {
                verdict: { type: "string", enum: ["correct", "incorrect"] },
              },
              required: ["verdict"],
              additionalProperties: false,
            },
          },
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error && err.name === "TimeoutError"
        ? "timeout"
        : "network_error",
      model,
      durationMs: Date.now() - started,
      raw: null,
    };
  }

  const durationMs = Date.now() - started;
  const json = (await res.json().catch(() => null)) as
    | ChatCompletionResponse
    | null;
  const raw = (json as Record<string, unknown> | null) ?? null;

  if (!res.ok) {
    return {
      ok: false,
      error: `http_${res.status}: ${json?.error?.message ?? "no body"}`.slice(0, 500),
      model,
      durationMs,
      raw,
    };
  }

  const content = json?.choices?.[0]?.message?.content ?? "";
  const verdict = parseVerdict(content);
  if (verdict === null) {
    // Strict schema should make this unreachable, but a truncated or refused
    // reply must surface as retryable, never as a grade.
    return { ok: false, error: "unparseable_verdict", model, durationMs, raw };
  }

  return {
    ok: true,
    verdict,
    model,
    promptTokens: json?.usage?.prompt_tokens ?? null,
    completionTokens: json?.usage?.completion_tokens ?? null,
    durationMs,
    raw,
  };
}
