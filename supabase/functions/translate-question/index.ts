// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  DEFAULT_TRANSLATION_MODEL,
  TRANSLATION_ATTEMPT_TIMEOUT_MS,
  TRANSLATION_FUNCTION_BUDGET_MS,
  TRANSLATION_MAX_COMPLETION_TOKENS,
  TRANSLATION_MIN_ATTEMPT_MS,
  buildTranslationMessages,
  isRetryableTranslationError,
  languageByCode,
  parseTranslateRequest,
  parseTranslationOutput,
  sourceHash,
  translationResponseSchema,
  type QuestionTranslationRow,
  type TranslateFunctionResponse,
  type TranslatedFields,
  type TranslationRecord,
  type TranslationSource,
} from "../_shared/translation-core.ts";

/**
 * translate-question — the ONE place question text meets OpenAI.
 *
 * Called server-to-server by the Next.js app (POST /api/tests/[id]/translate
 * and the admin Regenerate action) with the project's default SECRET key in
 * the `apikey` header. `withSupabase({ auth: "secret" })` rejects everything
 * else — publishable keys and user JWTs included — so the browser can never
 * reach this function and spend money directly; the Next route owns identity,
 * ownership, the language allow-list and the daily caps, and this function
 * trusts a caller that got past that gate. (config.toml keeps verify_jwt off
 * because sb_secret keys are not JWTs; the auth happens here instead.)
 *
 * Contract: see TranslateFunctionRequest / TranslateFunctionResponse in the
 * shared core. Every call — success or failure — lands in translation_events
 * (the caps and the spend strip count those rows); only a parsed, complete
 * translation is upserted into question_translations, keyed by
 * (question_id, language) with the hash of the exact source it translated.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

type OpenAIResult =
  | {
      ok: true;
      content: string;
      promptTokens: number | null;
      completionTokens: number | null;
    }
  | { ok: false; error: string };

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

async function callOpenAI(input: {
  apiKey: string;
  model: string;
  source: TranslationSource;
  language: NonNullable<ReturnType<typeof languageByCode>>;
  timeoutMs: number;
}): Promise<OpenAIResult> {
  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        messages: buildTranslationMessages(input.source, input.language),
        // NOT max_tokens — deprecated for the reasoning-model families.
        max_completion_tokens: TRANSLATION_MAX_COMPLETION_TOKENS,
        // Translation is transcription, not derivation; low keeps the
        // student's wait short.
        reasoning_effort: "low",
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "question_translation",
            strict: true,
            schema: translationResponseSchema(
              input.source.options.map((o) => o.id)
            ),
          },
        },
      }),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.name === "TimeoutError"
          ? "timeout"
          : "network_error",
    };
  }

  const json = (await res.json().catch(() => null)) as
    | ChatCompletionResponse
    | null;
  if (!res.ok) {
    return {
      ok: false,
      error: `http_${res.status}: ${json?.error?.message ?? "no body"}`.slice(
        0,
        500
      ),
    };
  }
  return {
    ok: true,
    content: json?.choices?.[0]?.message?.content ?? "",
    promptTokens: json?.usage?.prompt_tokens ?? null,
    completionTokens: json?.usage?.completion_tokens ?? null,
  };
}

function json(body: TranslateFunctionResponse, status = 200): Response {
  return Response.json(body, { status });
}

type TranslationRow = Omit<QuestionTranslationRow, "created_at">;

function toRecord(row: TranslationRow): TranslationRecord {
  return {
    questionId: row.question_id,
    language: row.language,
    stem: row.stem,
    options: row.options ?? {},
    explanation: row.explanation,
    modelAnswer: row.model_answer,
    sourceHash: row.source_hash,
    model: row.model,
    updatedAt: row.updated_at,
  };
}

export default {
  fetch: withSupabase({ auth: "secret" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return json({ ok: false, error: "invalid_request" }, 405);
    }
    const body = await req.json().catch(() => null);
    const request = parseTranslateRequest(body);
    const language = request ? languageByCode(request.language) : null;
    if (!request || !language) {
      return json({ ok: false, error: "invalid_request" }, 400);
    }

    const admin = ctx.supabaseAdmin;

    // ── The source, exactly as the app serves it ────────────
    const [questionRes, optionsRes, modelAnswerRes] = await Promise.all([
      admin
        .from("questions")
        .select("id, stem, explanation")
        .eq("id", request.questionId)
        .maybeSingle(),
      admin
        .from("question_options")
        .select("id, label, position")
        .eq("question_id", request.questionId)
        .is("deleted_at", null)
        .order("position"),
      admin
        .from("question_model_answers")
        .select("model_answer")
        .eq("question_id", request.questionId)
        .maybeSingle(),
    ]);
    if (questionRes.error || optionsRes.error || modelAnswerRes.error) {
      return json({ ok: false, error: "storage_failed" }, 500);
    }
    // Soft-deleted questions are NOT refused: past papers keep them (deletes
    // are soft for exactly that reason), review still serves them, and the
    // calling route has already proved the question is on the student's
    // paper. Only a question that truly doesn't exist is a 404.
    const question = questionRes.data as {
      id: string;
      stem: string;
      explanation: string;
    } | null;
    if (!question) {
      return json({ ok: false, error: "question_not_found" }, 404);
    }
    const source: TranslationSource = {
      stem: question.stem,
      explanation: question.explanation,
      modelAnswer:
        (modelAnswerRes.data as { model_answer: string } | null)
          ?.model_answer ?? null,
      options: ((optionsRes.data ?? []) as { id: string; label: string }[]).map(
        (o) => ({ id: o.id, label: o.label })
      ),
    };
    const hash = await sourceHash(source);

    // ── Idempotence: a current row is the answer ────────────
    // The Next route already checked the cache, but two students clicking
    // the same untranslated question within seconds both get here; the
    // second one finding the first one's row is what keeps the duplicate
    // spend to the genuinely concurrent window.
    if (!request.force) {
      const { data: existing } = await admin
        .from("question_translations")
        .select(
          "question_id, language, stem, options, explanation, model_answer, source_hash, model, updated_at"
        )
        .eq("question_id", request.questionId)
        .eq("language", request.language)
        .maybeSingle();
      const row = existing as TranslationRow | null;
      if (row && row.source_hash === hash) {
        return json({ ok: true, fresh: false, translation: toRecord(row) });
      }
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return json({ ok: false, error: "not_configured" }, 503);
    }
    const model =
      Deno.env.get("OPENAI_TRANSLATION_MODEL") || DEFAULT_TRANSLATION_MODEL;

    // ── The call, with one retry inside the budget ──────────
    // Token usage is summed across attempts: a truncated first reply was
    // still billed, and the spend strip must see it. `lastError` is the
    // error of the attempt that ended the loop.
    const started = Date.now();
    const deadline = started + TRANSLATION_FUNCTION_BUDGET_MS;
    let fields: TranslatedFields | null = null;
    let lastError = "no_attempt";
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < TRANSLATION_MIN_ATTEMPT_MS) break;
      const result = await callOpenAI({
        apiKey,
        model,
        source,
        language,
        timeoutMs: Math.min(TRANSLATION_ATTEMPT_TIMEOUT_MS, remaining),
      });
      if (!result.ok) {
        lastError = result.error;
        if (!isRetryableTranslationError(result.error)) break;
        continue;
      }
      if (result.promptTokens !== null) {
        promptTokens = (promptTokens ?? 0) + result.promptTokens;
      }
      if (result.completionTokens !== null) {
        completionTokens = (completionTokens ?? 0) + result.completionTokens;
      }
      fields = parseTranslationOutput(result.content, source);
      if (fields) break;
      // A truncated or refused reply is worth one more try, but must
      // surface honestly if it repeats — never as a cached translation.
      lastError = "unparseable_output";
    }
    const durationMs = Date.now() - started;

    // ── Every call is logged, verdict or failure ────────────
    // The row's id is kept so a failed cache write below can flip it to
    // ok = false: an ok row with no cache row would burn a cap unit for a
    // translation the student never received.
    const { data: event, error: eventError } = await admin
      .from("translation_events")
      .insert({
        user_id: request.userId,
        test_id: request.testId,
        question_id: request.questionId,
        language: request.language,
        trigger: request.trigger,
        ok: fields !== null,
        model,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        duration_ms: durationMs,
        error: fields !== null ? null : lastError,
      })
      .select("id")
      .maybeSingle();
    if (eventError) {
      console.error("translation event write failed", eventError);
    }

    if (!fields) {
      return json(
        {
          ok: false,
          error:
            lastError === "unparseable_output"
              ? "unparseable_output"
              : "translation_failed",
          detail: lastError,
        },
        502
      );
    }

    const now = new Date().toISOString();
    const { data: saved, error: saveError } = await admin
      .from("question_translations")
      .upsert(
        {
          question_id: request.questionId,
          language: request.language,
          stem: fields.stem,
          options: fields.options,
          explanation: fields.explanation,
          model_answer: fields.modelAnswer,
          source_hash: hash,
          model,
          updated_at: now,
        },
        { onConflict: "question_id,language" }
      )
      .select(
        "question_id, language, stem, options, explanation, model_answer, source_hash, model, updated_at"
      )
      .single();
    if (saveError || !saved) {
      console.error("translation upsert failed", saveError);
      const eventId = (event as { id: string } | null)?.id;
      if (eventId) {
        await admin
          .from("translation_events")
          .update({ ok: false, error: "storage_failed" })
          .eq("id", eventId);
      }
      return json({ ok: false, error: "storage_failed" }, 500);
    }

    return json({
      ok: true,
      fresh: true,
      translation: toRecord(saved as TranslationRow),
    });
  }),
};
