import {
  isRtl,
  LANGUAGES,
  languageByCode,
  type Language,
} from "@/lib/translation-core";
import type { ReviewQuestion } from "@/lib/results";
import type { TakeQuestion } from "@/lib/tests";

/**
 * Client-side translation rules: the one shape the runners and review render
 * from, the per-test "shown" memory in localStorage, button copy, and the
 * lang/dir attributes translated text carries. Pure so vitest pins them;
 * imported by Client Components, so nothing here may touch `server-only`
 * modules (the two type imports above are erased at build).
 */

export type Translation = {
  language: string;
  stem: string;
  /** option id → translated label. */
  options: Record<string, string>;
  /** Present only once the English explanation has been served. */
  explanation?: string;
  modelAnswer?: string;
};

/** The take page's cached translation for a question, merged with whatever
 * reveal fields the server was allowed to include. */
export function translationFromTake(q: TakeQuestion): Translation | null {
  if (!q.translation) return null;
  return {
    language: q.translation.language,
    stem: q.translation.stem,
    options: q.translation.options,
    ...(q.reveal?.translatedExplanation !== undefined
      ? { explanation: q.reveal.translatedExplanation }
      : {}),
    ...(q.reveal?.translatedModelAnswer !== undefined
      ? { modelAnswer: q.reveal.translatedModelAnswer }
      : {}),
  };
}

/** Review: a finished paper, so every field may be present. */
export function translationFromReview(q: ReviewQuestion): Translation | null {
  if (q.withheld || !q.translation) return null;
  return {
    language: q.translation.language,
    stem: q.translation.stem,
    options: q.translation.options,
    explanation: q.translation.explanation,
    ...(q.translation.modelAnswer !== null
      ? { modelAnswer: q.translation.modelAnswer }
      : {}),
  };
}

// ── Per-test memory of what the student chose to see ──────────

export const TRANSLATION_STORAGE_PREFIX = "cmeprep.translation.";

export function translationStorageKey(testId: string): string {
  return `${TRANSLATION_STORAGE_PREFIX}${testId}`;
}

export type ShownRecord = {
  /** Question ids the student is viewing translated. */
  shown: string[];
  /** The one-time "AI-generated" notice was dismissed for this test. */
  noticeDismissed: boolean;
};

export const EMPTY_SHOWN_RECORD: ShownRecord = { shown: [], noticeDismissed: false };

/** Tolerant of garbage and older shapes: anything unreadable is an empty
 * record, never an exception — a remembered preference must not take the
 * exam screen down. */
export function parseShownRecord(raw: string | null): ShownRecord {
  if (!raw) return EMPTY_SHOWN_RECORD;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return EMPTY_SHOWN_RECORD;
    const o = parsed as { shown?: unknown; noticeDismissed?: unknown };
    return {
      shown: Array.isArray(o.shown)
        ? o.shown.filter((v): v is string => typeof v === "string")
        : [],
      noticeDismissed: o.noticeDismissed === true,
    };
  } catch {
    return EMPTY_SHOWN_RECORD;
  }
}

export function serializeShownRecord(record: ShownRecord): string {
  return JSON.stringify({
    shown: record.shown,
    noticeDismissed: record.noticeDismissed,
  });
}

// ── Copy and attributes ───────────────────────────────────────

export type TranslationStatus =
  | "idle"
  | "pending"
  | "shown"
  | "original"
  | "error";

/** The button's copy split so the native name can carry its own lang/dir:
 * `prefix + name` is the full label. */
export function translateButtonParts(
  language: string | null,
  status: TranslationStatus
): { prefix: string; name: string | null } {
  const name = languageByCode(language)?.nativeName ?? null;
  switch (status) {
    case "pending":
      return { prefix: "Translating…", name: null };
    case "error":
      return { prefix: "Retry translation", name: null };
    case "shown":
      return { prefix: "Show original", name: null };
    case "original":
      return name
        ? { prefix: "Show ", name }
        : { prefix: "Show translation", name: null };
    default:
      return name
        ? { prefix: "Translate to ", name }
        : { prefix: "Translate", name: null };
  }
}

export function translateButtonLabel(
  language: string | null,
  status: TranslationStatus
): string {
  const { prefix, name } = translateButtonParts(language, status);
  return name ? `${prefix}${name}` : prefix;
}

/**
 * Attributes for a text node showing translated content: `lang` switches
 * screen-reader voice and hyphenation, `dir` isolates RTL scripts inside the
 * LTR page (unicode-bidi: isolate comes with it). Fonts need no opt-in: the
 * brand font tokens carry the script fallbacks (app/globals.css), so every
 * text node already renders non-Latin glyphs deliberately. Empty when the
 * English is on screen, so the DOM is unchanged for today's users.
 */
export function translatedAttrs(
  language: string | null
): { lang?: string; dir?: "ltr" | "rtl" } {
  if (!language) return {};
  return { lang: language, dir: isRtl(language) ? "rtl" : "ltr" };
}

/** The label of an option row: the translation when the shown record has
 * one for this id, else the English — an option added after the row was
 * translated simply stays English until the hash marks the row stale. */
export function optionTranslation(
  shown: Translation | null,
  option: { id: string; label: string }
): { label: string; translated: { language: string } | null } {
  const label = shown?.options[option.id];
  return label !== undefined && shown
    ? { label, translated: { language: shown.language } }
    : { label: option.label, translated: null };
}

/** The page's cached translations, keyed by question id — the hook's seed. */
export function seedTakeTranslations(
  questions: readonly TakeQuestion[]
): Map<string, Translation> {
  const map = new Map<string, Translation>();
  for (const q of questions) {
    const t = translationFromTake(q);
    if (t) map.set(q.questionId, t);
  }
  return map;
}

export function seedReviewTranslations(
  questions: readonly ReviewQuestion[]
): Map<string, Translation> {
  const map = new Map<string, Translation>();
  for (const q of questions) {
    const t = translationFromReview(q);
    if (t) map.set(q.questionId, t);
  }
  return map;
}

/** Registry entries for the enabled codes, in registry order. */
export function enabledRegistry(codes: readonly string[]): Language[] {
  const set = new Set(codes);
  return LANGUAGES.filter((l) => set.has(l.code));
}

/** Registry entries a student could ask for: known but not enabled. */
export function requestableLanguages(codes: readonly string[]): Language[] {
  const set = new Set(codes);
  return LANGUAGES.filter((l) => !set.has(l.code));
}

// ── Failure taxonomy for the translate route ──────────────────

export type TranslateFailure =
  | { kind: "language_required" }
  | { kind: "capped"; message: string }
  | { kind: "disabled"; message: string }
  | { kind: "error"; message: string };

/** One mapping from the route's status codes to what the UI does, so every
 * surface reacts the same way. 502/503 and anything unexpected are one
 * case: the server's message (or a default) in a toast, and a retry. */
export function translateErrorFor(
  status: number,
  body: unknown
): TranslateFailure {
  const b = (typeof body === "object" && body !== null ? body : {}) as {
    error?: string;
    message?: string;
  };
  if (status === 409 && b.error === "language_required") {
    return { kind: "language_required" };
  }
  if (status === 429) {
    return {
      kind: "capped",
      message: b.message ?? "Translation limit reached for today.",
    };
  }
  if (status === 400 && b.error === "language_not_enabled") {
    return {
      kind: "disabled",
      message: b.message ?? "That language isn't available.",
    };
  }
  return {
    kind: "error",
    message:
      b.message ??
      (status === 502 || status === 503
        ? "Translation is unavailable right now — showing English."
        : "Could not translate this question. Try again."),
  };
}
