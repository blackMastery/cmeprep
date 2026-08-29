import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  isUuidLike,
  LANGUAGES,
  sourceHash,
  translationCapWindowStart,
  type TranslateFunctionResponse,
  type TranslationSource,
} from "@/lib/translation-core";
import {
  invokeTranslateFunction,
  loadTranslationSources,
} from "@/lib/translations";
import { escapeLike } from "@/lib/admin/question-filters-core";
import {
  STALE_SCAN_LIMIT,
  type TranslationListFilters,
} from "@/lib/admin/translation-filters-core";

/**
 * Admin side of on-demand translation: the coverage list (staleness is the
 * same hash over the same sources the student read path uses —
 * loadTranslationSources is shared, not copied), per-language counts, the
 * enable toggles, language requests, regenerate/delete, and the spend strip.
 * Service-role throughout — callers verify the admin first.
 */

export type TranslationListRow = {
  questionId: string;
  language: string;
  updatedAt: string;
  model: string;
  /** The live source no longer matches what was translated. */
  stale: boolean;
  questionDeleted: boolean;
  subjectName: string;
  examName: string;
  original: {
    stem: string;
    explanation: string;
    modelAnswer: string | null;
    options: { id: string; label: string }[];
  };
  translation: {
    stem: string;
    explanation: string;
    modelAnswer: string | null;
    options: Record<string, string>;
  };
};

export type TranslationList = {
  rows: TranslationListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** The stale scan hit STALE_SCAN_LIMIT: the count is a floor. */
  truncated: boolean;
};

type EmbeddedRow = {
  question_id: string;
  language: string;
  stem: string;
  options: Record<string, string>;
  explanation: string;
  model_answer: string | null;
  source_hash: string;
  model: string;
  updated_at: string;
  questions: {
    id: string;
    stem: string;
    explanation: string;
    deleted_at: string | null;
    subjects: {
      name: string;
      specialties: { exams: { name: string } | null } | null;
    } | null;
  } | null;
};

const ROW_COLUMNS =
  "question_id, language, stem, options, explanation, model_answer, source_hash, model, updated_at, " +
  "questions!inner(id, stem, explanation, deleted_at, subjects(name, specialties(exams(name))))";

async function toListRows(
  admin: ReturnType<typeof createAdminClient>,
  rows: EmbeddedRow[]
): Promise<TranslationListRow[]> {
  if (rows.length === 0) return [];
  const sources = await loadTranslationSources(admin, [
    ...new Set(rows.map((r) => r.question_id)),
  ]);
  return Promise.all(
    rows.map(async (r) => {
      const q = r.questions;
      const source: TranslationSource = sources.get(r.question_id) ?? {
        stem: q?.stem ?? "",
        explanation: q?.explanation ?? "",
        modelAnswer: null,
        options: [],
      };
      return {
        questionId: r.question_id,
        language: r.language,
        updatedAt: r.updated_at,
        model: r.model,
        stale: (await sourceHash(source)) !== r.source_hash,
        questionDeleted: q?.deleted_at !== null,
        subjectName: q?.subjects?.name ?? "",
        examName: q?.subjects?.specialties?.exams?.name ?? "",
        original: source,
        translation: {
          stem: r.stem,
          explanation: r.explanation,
          modelAnswer: r.model_answer,
          options: r.options ?? {},
        },
      };
    })
  );
}

function applyFilters<
  Q extends {
    eq: (col: string, v: string) => Q;
    ilike: (col: string, v: string) => Q;
    gte: (col: string, v: string) => Q;
    lt: (col: string, v: string) => Q;
  },
>(query: Q, filters: TranslationListFilters): Q {
  let q = query;
  if (filters.language) q = q.eq("language", filters.language);
  if (filters.search) {
    q = isUuidLike(filters.search)
      ? q.eq("question_id", filters.search)
      : q.ilike("questions.stem", `%${escapeLike(filters.search)}%`);
  }
  if (filters.from) q = q.gte("updated_at", `${filters.from}T00:00:00Z`);
  if (filters.to) {
    // Inclusive end date: everything before the following midnight.
    const next = new Date(`${filters.to}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    q = q.lt("updated_at", next.toISOString());
  }
  return q;
}

export async function listTranslations(
  filters: TranslationListFilters
): Promise<TranslationList> {
  const admin = createAdminClient();
  const { page, pageSize } = filters;
  const from = (page - 1) * pageSize;

  if (filters.stale) {
    // Staleness is a hash of live text, so it can't be a WHERE clause: scan
    // the newest rows, hash them, and page the survivors in memory.
    const { data } = await applyFilters(
      admin
        .from("question_translations")
        .select(ROW_COLUMNS)
        .order("updated_at", { ascending: false })
        .limit(STALE_SCAN_LIMIT),
      filters
    );
    const scanned = (data ?? []) as unknown as EmbeddedRow[];
    const stale = (await toListRows(admin, scanned)).filter((r) => r.stale);
    const total = stale.length;
    return {
      rows: stale.slice(from, from + pageSize),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      truncated: scanned.length === STALE_SCAN_LIMIT,
    };
  }

  const { data, count } = await applyFilters(
    admin
      .from("question_translations")
      .select(ROW_COLUMNS, { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(from, from + pageSize - 1),
    filters
  );
  const total = count ?? 0;
  return {
    rows: await toListRows(admin, (data ?? []) as unknown as EmbeddedRow[]),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    truncated: false,
  };
}

export type LanguageState = {
  code: string;
  enabled: boolean;
  /** Cached rows in this language. */
  cached: number;
  /** Students who asked for it. */
  requests: number;
};

/**
 * Every registry language with its toggle, cache size and request count —
 * the admin's languages card. Two round trips: the toggles, and ONE
 * group-by RPC for both counts (translation_language_counts), so the page
 * doesn't fan out per language and the request tally can't be truncated by
 * PostgREST's max_rows. Registry order; a toggle row for a code the registry
 * no longer knows is ignored.
 */
export async function listLanguageStates(): Promise<LanguageState[]> {
  const admin = createAdminClient();
  const [{ data: toggles }, { data: counts, error }] = await Promise.all([
    admin.from("translation_languages").select("code, enabled"),
    admin.rpc("translation_language_counts"),
  ]);
  if (error) console.error("translation_language_counts_failed", error.message);
  const toggleByCode = new Map((toggles ?? []).map((t) => [t.code, t]));
  const countByCode = new Map((counts ?? []).map((c) => [c.language, c]));
  return LANGUAGES.map((l) => ({
    code: l.code,
    enabled: toggleByCode.get(l.code)?.enabled ?? false,
    cached: countByCode.get(l.code)?.cached ?? 0,
    requests: countByCode.get(l.code)?.requests ?? 0,
  }));
}

export async function setLanguageEnabled(
  code: string,
  enabled: boolean,
  adminId: string
): Promise<boolean> {
  const now = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("translation_languages")
    .upsert(
      {
        code,
        enabled,
        enabled_at: enabled ? now : null,
        enabled_by: enabled ? adminId : null,
        updated_at: now,
      },
      { onConflict: "code" }
    );
  return !error;
}

/** Admin regenerate: translate again even if the row is current. The
 * function logs the call as trigger 'admin', which the cap counters skip
 * (translationCapHit) — uncapped, and never feeding the students' breaker;
 * the spend strip still counts its tokens. */
export async function regenerateTranslation(
  questionId: string,
  language: string,
  adminId: string
): Promise<TranslateFunctionResponse> {
  return invokeTranslateFunction({
    questionId,
    language,
    userId: adminId,
    testId: null,
    trigger: "admin",
    force: true,
  });
}

export async function deleteTranslation(
  questionId: string,
  language: string
): Promise<boolean> {
  const { error } = await createAdminClient()
    .from("question_translations")
    .delete()
    .eq("question_id", questionId)
    .eq("language", language);
  return !error;
}

export type TranslationSpend = {
  cachedTotal: number;
  freshToday: number;
  failedToday: number;
  promptTokensToday: number;
  completionTokensToday: number;
  /** The model today's calls ran on (the latest, if several). */
  model: string | null;
};

/** Today's calls (Guyana day) and the cache size — the spend strip. */
export async function translationSpend(now: Date): Promise<TranslationSpend> {
  const admin = createAdminClient();
  const [{ data: events }, { count }] = await Promise.all([
    admin
      .from("translation_events")
      .select("ok, prompt_tokens, completion_tokens, model, created_at")
      .gte("created_at", translationCapWindowStart(now))
      .order("created_at", { ascending: false })
      .limit(5000),
    admin
      .from("question_translations")
      .select("question_id", { count: "exact", head: true }),
  ]);
  const spend: TranslationSpend = {
    cachedTotal: count ?? 0,
    freshToday: 0,
    failedToday: 0,
    promptTokensToday: 0,
    completionTokensToday: 0,
    model: events?.[0]?.model ?? null,
  };
  for (const e of events ?? []) {
    if (e.ok) spend.freshToday += 1;
    else spend.failedToday += 1;
    spend.promptTokensToday += e.prompt_tokens ?? 0;
    spend.completionTokensToday += e.completion_tokens ?? 0;
  }
  return spend;
}
