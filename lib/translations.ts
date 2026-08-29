import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  LANGUAGES,
  resolveTranslationLanguage,
  sourceHash,
  TRANSLATE_ROUTE_TIMEOUT_MS,
  TRANSLATION_GLOBAL_DAILY_CAP,
  TRANSLATION_USER_DAILY_CAP,
  translationCapWindowStart,
  type LanguageResolution,
  type TranslateFunctionRequest,
  type TranslateFunctionResponse,
  type TranslationSource,
} from "@/lib/translation-core";

/**
 * Server side of on-demand translation: the enabled-language set, the
 * hash-verified cache read every student surface uses, the daily-cap
 * counters, and the one call into the translate-question Edge Function.
 * The rules (registry, resolver, hash, caps) live in lib/translation-core.ts;
 * this file only does the DB and network work.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** A cache row that is CURRENT — its hash matches the live source. */
export type CachedTranslation = {
  language: string;
  stem: string;
  options: Record<string, string>;
  explanation: string;
  modelAnswer: string | null;
};

/**
 * Languages the picker offers, in registry order. Uses the RLS'd client on
 * purpose: translation_languages is granted to anon, so the marketing page
 * can read it logged-out. A row for a code the registry no longer ships is
 * ignored rather than offered.
 */
export async function listEnabledLanguageCodes(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("translation_languages")
    .select("code")
    .eq("enabled", true);
  const enabled = new Set((data ?? []).map((r) => r.code));
  return LANGUAGES.filter((l) => enabled.has(l.code)).map((l) => l.code);
}

export async function isLanguageEnabled(code: string): Promise<boolean> {
  return (await listEnabledLanguageCodes()).includes(code);
}

/**
 * The language a new paper is created with (resolveTranslationLanguage with
 * no frozen language). `null` requested is the wizard's explicit "English
 * only"; `undefined` is no choice, which falls back to the profile default.
 * Skips the enabled-set read when there is nothing to check — the common
 * case of a student with no language set.
 */
export async function resolveNewTestLanguage(
  requested: string | null | undefined,
  profileDefault: string | null
): Promise<LanguageResolution> {
  const nothingToCheck =
    requested === null || (requested === undefined && !profileDefault);
  const enabled = nothingToCheck ? [] : await listEnabledLanguageCodes();
  return resolveTranslationLanguage({
    testLanguage: null,
    requested,
    profileDefault,
    enabled,
  });
}

/**
 * The exact text a translation is (or would be) made from, per question:
 * live stem + explanation, LIVE options in authored position order, and the
 * model answer for OSCE stations only. This is the hash input, so it is the
 * ONE place that shape is assembled on the Node side — the admin coverage
 * list and every student read compare against the same bytes. (The Edge
 * Function assembles the same shape in Deno; TranslationSource pins it.)
 */
export async function loadTranslationSources(
  admin: Admin,
  questionIds: string[]
): Promise<Map<string, TranslationSource>> {
  const out = new Map<string, TranslationSource>();
  if (questionIds.length === 0) return out;

  const [{ data: questions }, { data: options }] = await Promise.all([
    admin
      .from("questions")
      .select("id, type, stem, explanation")
      .in("id", questionIds),
    admin
      .from("question_options")
      .select("id, question_id, label, position")
      .is("deleted_at", null)
      .in("question_id", questionIds)
      .order("position"),
  ]);
  // Model answers exist only for OSCE stations; skip the query entirely on
  // the overwhelmingly common all-MCQ paper.
  const osceIds = (questions ?? []).filter((q) => q.type === "osce").map((q) => q.id);
  const { data: modelAnswers } =
    osceIds.length > 0
      ? await admin
          .from("question_model_answers")
          .select("question_id, model_answer")
          .in("question_id", osceIds)
      : { data: null };

  const modelAnswerById = new Map(
    (modelAnswers ?? []).map((m) => [m.question_id, m.model_answer])
  );
  const optionsByQuestion = new Map<string, { id: string; label: string }[]>();
  for (const o of options ?? []) {
    const list = optionsByQuestion.get(o.question_id) ?? [];
    list.push({ id: o.id, label: o.label });
    optionsByQuestion.set(o.question_id, list);
  }
  for (const q of questions ?? []) {
    out.set(q.id, {
      stem: q.stem,
      explanation: q.explanation,
      modelAnswer: modelAnswerById.get(q.id) ?? null,
      options: optionsByQuestion.get(q.id) ?? [],
    });
  }
  return out;
}

/**
 * Cached translations for these questions in one language, keyed by
 * question id — ONLY rows whose source_hash still matches the live source.
 * A stale row (the admin edited the question since) is treated exactly like
 * a missing one: never served, re-translated on the next click. Callers
 * that already hold the sources (take state, review) pass them in; anything
 * missing from that map is loaded here. Nothing loaded here is returned to
 * the caller except the translated fields, which the caller then gates.
 */
export async function loadTranslationsFor(
  admin: Admin,
  questionIds: string[],
  language: string,
  sources?: Map<string, TranslationSource>
): Promise<Map<string, CachedTranslation>> {
  const out = new Map<string, CachedTranslation>();
  if (questionIds.length === 0) return out;

  const { data: rows } = await admin
    .from("question_translations")
    .select("question_id, stem, options, explanation, model_answer, source_hash")
    .eq("language", language)
    .in("question_id", questionIds);
  if (!rows || rows.length === 0) return out;

  const missing = rows
    .map((r) => r.question_id)
    .filter((id) => !sources?.has(id));
  const loaded =
    missing.length > 0 ? await loadTranslationSources(admin, missing) : null;

  await Promise.all(
    rows.map(async (row) => {
      const source =
        sources?.get(row.question_id) ?? loaded?.get(row.question_id);
      if (!source) return;
      if ((await sourceHash(source)) !== row.source_hash) return;
      out.set(row.question_id, {
        language,
        stem: row.stem,
        options: row.options ?? {},
        explanation: row.explanation,
        modelAnswer: row.model_answer,
      });
    })
  );
  return out;
}

/**
 * The translated answer-key fields a response may carry, given what the
 * English gate allows (revealFieldsAllowed). Every path that serves reveal
 * data — take state, the reveal and grade routes, the translate route —
 * projects through this, so the translated explanation can never be served
 * under a different rule than the English one.
 */
export function translatedRevealFields(
  t: CachedTranslation | null | undefined,
  allowed: { explanation: boolean; modelAnswer: boolean }
): { translatedExplanation?: string; translatedModelAnswer?: string } {
  if (!t) return {};
  return {
    ...(allowed.explanation ? { translatedExplanation: t.explanation } : {}),
    ...(allowed.modelAnswer && t.modelAnswer !== null
      ? { translatedModelAnswer: t.modelAnswer }
      : {}),
  };
}

/**
 * Which daily cap, if any, this fresh translation would breach. Successful
 * STUDENT calls only: a failed call told the student to retry, and an admin
 * regenerate is a manual, audited click that must not trip the students'
 * breaker. Soft under concurrency, like the OSCE cap: two in-flight calls at
 * 99 can land 101 — this caps spend, it doesn't meter billing.
 */
export async function translationCapHit(
  admin: Admin,
  userId: string,
  now: Date
): Promise<"user_cap" | "global_cap" | null> {
  const since = translationCapWindowStart(now);
  const [{ count: mine }, { count: everyone }] = await Promise.all([
    admin
      .from("translation_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("trigger", "student")
      .eq("ok", true)
      .gte("created_at", since),
    admin
      .from("translation_events")
      .select("id", { count: "exact", head: true })
      .eq("trigger", "student")
      .eq("ok", true)
      .gte("created_at", since),
  ]);
  if ((mine ?? 0) >= TRANSLATION_USER_DAILY_CAP) return "user_cap";
  if ((everyone ?? 0) >= TRANSLATION_GLOBAL_DAILY_CAP) return "global_cap";
  return null;
}

/**
 * The call into supabase/functions/translate-question. Plain fetch with the
 * project's default SECRET key in `apikey` — the only credential the
 * function's `withSupabase({ auth: "secret" })` accepts — so this must never
 * run anywhere but on the server (the `server-only` import above enforces
 * it). Never throws: every outcome is a TranslateFunctionResponse the route
 * maps to a status code. Only a missing key or URL throws — that is
 * deployment misconfiguration, not weather.
 */
export async function invokeTranslateFunction(
  body: TranslateFunctionRequest
): Promise<TranslateFunctionResponse> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!baseUrl || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY are not set");
  }
  // The function's secret mode validates the NEW key family only. The legacy
  // service_role JWT still works for supabase-js, so the app runs fine and
  // every translation quietly 401s — say so, once per call, where the Next
  // log is looked at.
  if (key.startsWith("eyJ")) {
    console.error(
      "SUPABASE_SECRET_KEY is a legacy JWT; the translate-question function only accepts an sb_secret_… key (Project Settings → API Keys → Secret keys, or `supabase status` locally)."
    );
  }
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/functions/v1/translate-question`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TRANSLATE_ROUTE_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      error: "translation_failed",
      detail:
        err instanceof Error && err.name === "TimeoutError"
          ? "timeout"
          : "network_error",
    };
  }
  const json = (await res.json().catch(() => null)) as
    | TranslateFunctionResponse
    | null;
  if (!json || typeof json.ok !== "boolean") {
    return { ok: false, error: "translation_failed", detail: `http_${res.status}` };
  }
  return json;
}
