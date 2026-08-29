"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { languageByCode } from "@/lib/translation-core";
import {
  EMPTY_SHOWN_RECORD,
  parseShownRecord,
  serializeShownRecord,
  translateErrorFor,
  translationStorageKey,
  type ShownRecord,
  type Translation,
  type TranslationStatus,
} from "@/lib/translation-ui-core";
import type { TranslatePayload } from "@/app/api/tests/[id]/translate/route";

/**
 * Per-test translation state for the runners and review: which questions
 * have a translation (seeded from the page's cached ones, grown by clicks),
 * which the student is viewing translated, one request in flight per
 * question, and the session-wide "capped" / "unavailable" flags.
 *
 * One click = one question = at most one OpenAI call, and nothing here ever
 * requests a translation on its own: `translate()` is the button. Every
 * action on the api is referentially stable (they read the latest state
 * through a ref), so memoised consumers and keyboard effects can depend on
 * them without re-subscribing on every state change.
 */

export type TranslationApi = {
  /** The request affordance: languages exist and the server hasn't said
   * the paper's language is off. Existing translations stay toggleable
   * regardless — a student is never stranded in a language. */
  enabled: boolean;
  language: string | null;
  enabledLanguageCodes: readonly string[];
  capped: boolean;
  statusFor(questionId: string): TranslationStatus;
  /** The translation to RENDER — only while the student is viewing it. */
  translationFor(questionId: string): Translation | null;
  /** The button: cache hit → show; no language → picker; else request. */
  translate(questionId: string): void;
  /** Shown ↔ original. Never requests anything. */
  toggle(questionId: string): void;
  /** Reveal/grade responses carry the translated explanation; merge it. */
  merge(
    questionId: string,
    fields: Partial<Pick<Translation, "explanation" | "modelAnswer">>
  ): void;
  picker: { open: boolean; close(): void; pick(code: string): void };
  notice: { visible: boolean; dismiss(): void };
  /** For the ONE sr-only live region the owner renders (TranslationChrome).
   * The nonce lets an identical consecutive message announce again. */
  announcement: { text: string; nonce: number };
};

// ── The "shown" record: memory first, storage as best-effort persistence ──
// The in-memory map is the truth, so a browser that blocks storage (Safari
// "Block all cookies", a partitioned iframe, a full quota) still SHOWS the
// translation the student just paid for — it merely isn't remembered across
// reloads. localStorage can't be read on the server, so the first client
// value comes through useSyncExternalStore (server snapshot: nothing shown)
// — a useState initialiser would mismatch hydration, and setting state in an
// effect is the cascading render the lint rule forbids. Same pattern as the
// tutor widget's remembered-open flag.

const records = new Map<string, ShownRecord>();
const listeners = new Set<() => void>();

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readRecord(key: string): ShownRecord {
  const cached = records.get(key);
  if (cached) return cached;
  const parsed = parseShownRecord(readRaw(key));
  records.set(key, parsed);
  return parsed;
}

function writeRecord(key: string, record: ShownRecord) {
  records.set(key, record);
  try {
    window.localStorage.setItem(key, serializeShownRecord(record));
  } catch {
    // Not remembered across reloads; still applied now.
  }
  for (const l of listeners) l();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab wrote: drop the cached copy so the next read re-parses.
  const onStorage = (e: StorageEvent) => {
    if (e.key) records.delete(e.key);
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

const readOnServer = () => EMPTY_SHOWN_RECORD;

export function useQuestionTranslation(input: {
  testId: string;
  enabledLanguageCodes: readonly string[];
  /** tests.language, else a still-enabled profile default, else null. */
  initialLanguage: string | null;
  /** The page's cached translations (a DB read, never OpenAI). */
  initial: () => Map<string, Translation>;
}): TranslationApi {
  const { testId, enabledLanguageCodes } = input;
  const key = translationStorageKey(testId);

  const [translations, setTranslations] = useState(input.initial);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [errorIds, setErrorIds] = useState<ReadonlySet<string>>(new Set());
  const [language, setLanguage] = useState(input.initialLanguage);
  const [capped, setCapped] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState({ text: "", nonce: 0 });

  const record = useSyncExternalStore(subscribe, () => readRecord(key), readOnServer);
  const shown = useMemo(() => new Set(record.shown), [record]);

  // The latest state, for the stable actions below. Written after commit,
  // never during render (the refs lint rule); actions run on events, which
  // always come after a commit.
  const latest = useRef({ translations, pendingIds, capped, language, pickerFor });
  useEffect(() => {
    latest.current = { translations, pendingIds, capped, language, pickerFor };
  });

  const announce = useCallback((text: string) => {
    setAnnouncement((prev) => ({ text, nonce: prev.nonce + 1 }));
  }, []);

  const setShown = useCallback(
    (questionId: string, next: boolean) => {
      const current = readRecord(key);
      const set = new Set(current.shown);
      if (next) set.add(questionId);
      else set.delete(questionId);
      writeRecord(key, { ...current, shown: [...set] });
    },
    [key]
  );

  const request = useCallback(
    async (questionId: string, lang: string) => {
      setPendingIds((prev) => new Set(prev).add(questionId));
      setErrorIds((prev) => {
        if (!prev.has(questionId)) return prev;
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });
      try {
        const res = await fetch(`/api/tests/${testId}/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The language rides along so a paper without one gets it frozen
          // on this click; the server ignores it once the paper has one.
          body: JSON.stringify({ questionId, language: lang }),
        });
        const body = (await res.json().catch(() => null)) as unknown;
        if (!res.ok) {
          const failure = translateErrorFor(res.status, body);
          switch (failure.kind) {
            case "language_required":
              setPickerFor(questionId);
              return;
            case "capped":
              setCapped(true);
              toast.error(failure.message);
              announce("Translation limit reached for today.");
              return;
            case "disabled":
              // The paper's language was switched off under us: no more
              // requests, but what is already translated stays toggleable.
              setUnavailable(true);
              toast.error(failure.message);
              return;
            default:
              setErrorIds((prev) => new Set(prev).add(questionId));
              toast.error(failure.message);
              announce("Translation failed — showing English.");
              return;
          }
        }
        const data = body as TranslatePayload;
        setTranslations((prev) =>
          new Map(prev).set(questionId, {
            language: data.language,
            stem: data.stem,
            options: data.options,
            ...(data.explanation !== undefined
              ? { explanation: data.explanation }
              : {}),
            ...(data.modelAnswer !== undefined
              ? { modelAnswer: data.modelAnswer }
              : {}),
          })
        );
        // A concurrent first click in another tab may have frozen the
        // paper to a different language; the server translated into that
        // one and says so — follow it.
        if (data.language !== lang) setLanguage(data.language);
        setShown(questionId, true);
        announce(
          `Translated to ${languageByCode(data.language)?.nativeName ?? data.language}`
        );
      } catch {
        setErrorIds((prev) => new Set(prev).add(questionId));
        toast.error("Could not translate this question. Try again.");
        announce("Translation failed — showing English.");
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(questionId);
          return next;
        });
      }
    },
    [announce, setShown, testId]
  );

  const translate = useCallback(
    (questionId: string) => {
      const { translations, pendingIds, capped, language } = latest.current;
      if (translations.has(questionId)) {
        setShown(questionId, true);
        announce(
          `Showing ${languageByCode(language)?.nativeName ?? "translation"}`
        );
        return;
      }
      if (pendingIds.has(questionId) || capped) return;
      if (!language) {
        setPickerFor(questionId);
        return;
      }
      void request(questionId, language);
    },
    [announce, request, setShown]
  );

  const toggle = useCallback(
    (questionId: string) => {
      const { translations, language } = latest.current;
      if (!translations.has(questionId)) return;
      const next = !readRecord(key).shown.includes(questionId);
      setShown(questionId, next);
      announce(
        next
          ? `Showing ${languageByCode(language)?.nativeName ?? "translation"}`
          : "Showing original"
      );
    },
    [announce, key, setShown]
  );

  const merge = useCallback<TranslationApi["merge"]>((questionId, fields) => {
    setTranslations((prev) => {
      const existing = prev.get(questionId);
      if (!existing) return prev;
      return new Map(prev).set(questionId, { ...existing, ...fields });
    });
  }, []);

  const pick = useCallback(
    (code: string) => {
      const target = latest.current.pickerFor;
      setPickerFor(null);
      setLanguage(code);
      if (target) void request(target, code);
    },
    [request]
  );
  const closePicker = useCallback(() => setPickerFor(null), []);

  const anyShown = useMemo(
    () => [...shown].some((id) => translations.has(id)),
    [shown, translations]
  );
  const dismissNotice = useCallback(() => {
    writeRecord(key, { ...readRecord(key), noticeDismissed: true });
  }, [key]);

  return useMemo<TranslationApi>(
    () => ({
      enabled: enabledLanguageCodes.length > 0 && !unavailable,
      language,
      enabledLanguageCodes,
      capped,
      statusFor: (id) =>
        pendingIds.has(id)
          ? "pending"
          : errorIds.has(id)
            ? "error"
            : translations.has(id)
              ? shown.has(id)
                ? "shown"
                : "original"
              : "idle",
      translationFor: (id) =>
        shown.has(id) ? (translations.get(id) ?? null) : null,
      translate,
      toggle,
      merge,
      picker: { open: pickerFor !== null, close: closePicker, pick },
      notice: {
        visible: anyShown && !record.noticeDismissed,
        dismiss: dismissNotice,
      },
      announcement,
    }),
    [
      announcement,
      anyShown,
      capped,
      closePicker,
      dismissNotice,
      enabledLanguageCodes,
      errorIds,
      language,
      merge,
      pendingIds,
      pick,
      pickerFor,
      record.noticeDismissed,
      shown,
      toggle,
      translate,
      translations,
      unavailable,
    ]
  );
}
