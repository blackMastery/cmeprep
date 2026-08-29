import { describe, expect, it } from "vitest";
import {
  buildTranslationMessages,
  canonicalSource,
  DEFAULT_TRANSLATION_MODEL,
  isLanguageCode,
  isRetryableTranslationError,
  isRtl,
  LANGUAGES,
  languageByCode,
  parseTranslateRequest,
  parseTranslationOutput,
  resolveTranslationLanguage,
  revealFieldsAllowed,
  sourceHash,
  TRANSLATE_ROUTE_TIMEOUT_MS,
  TRANSLATION_ATTEMPT_TIMEOUT_MS,
  TRANSLATION_FUNCTION_BUDGET_MS,
  TRANSLATION_GLOBAL_DAILY_CAP,
  TRANSLATION_USER_DAILY_CAP,
  translationCapWindowStart,
  translationResponseSchema,
  type TranslationSource,
} from "@/lib/translation-core";

const source: TranslationSource = {
  stem: "A 45-year-old man presents with crushing chest pain. BP 90/60.",
  explanation: "Option B is correct: the ECG shows ST elevation in II, III, aVF.",
  modelAnswer: null,
  options: [
    { id: "11111111-1111-1111-1111-111111111111", label: "Aspirin 300 mg" },
    { id: "22222222-2222-2222-2222-222222222222", label: "Primary PCI" },
  ],
};

const goodReply = JSON.stringify({
  stem: "Un hombre de 45 años presenta dolor torácico opresivo. PA 90/60.",
  options: [
    { id: source.options[0].id, label: "Aspirina 300 mg" },
    { id: source.options[1].id, label: "ICP primaria" },
  ],
  explanation: "La opción B es correcta: el ECG muestra elevación del ST en II, III, aVF.",
  model_answer: null,
});

describe("language registry", () => {
  it("ships Spanish first and every code exactly once", () => {
    expect(LANGUAGES[0].code).toBe("es");
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(
      expect.arrayContaining([
        "zh", "hi", "fr", "ar", "bn", "pt", "ru", "ur", "id", "de", "ja",
        "sw", "fil", "ig", "yo", "wo", "ha", "am", "he",
      ])
    );
  });

  it("gives every language a name, a native name and a prompt note", () => {
    for (const l of LANGUAGES) {
      expect(l.name.length).toBeGreaterThan(0);
      expect(l.nativeName.length).toBeGreaterThan(0);
      expect(l.note.length).toBeGreaterThan(10);
    }
  });

  it("marks exactly the right-to-left scripts RTL", () => {
    expect(LANGUAGES.filter((l) => l.dir === "rtl").map((l) => l.code)).toEqual(
      ["ar", "ur", "he"]
    );
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("es")).toBe(false);
    expect(isRtl(null)).toBe(false);
  });

  it("looks codes up and rejects unknown ones", () => {
    expect(languageByCode("es")?.name).toBe("Spanish");
    expect(languageByCode("xx")).toBeNull();
    expect(languageByCode(undefined)).toBeNull();
    expect(isLanguageCode("fil")).toBe(true);
    expect(isLanguageCode("EN")).toBe(false);
  });
});

describe("canonicalSource / sourceHash", () => {
  it("is deterministic and versioned", () => {
    expect(canonicalSource(source)).toBe(canonicalSource({ ...source }));
    expect(canonicalSource(source)).toMatch(/^\{"v":1,/);
  });

  it("changes when ANY translated field changes, including option order", async () => {
    const base = await sourceHash(source);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(await sourceHash({ ...source, stem: source.stem + "!" })).not.toBe(base);
    expect(
      await sourceHash({ ...source, explanation: "different" })
    ).not.toBe(base);
    expect(await sourceHash({ ...source, modelAnswer: "" })).not.toBe(base);
    expect(
      await sourceHash({
        ...source,
        options: [source.options[1], source.options[0]],
      })
    ).not.toBe(base);
    expect(
      await sourceHash({
        ...source,
        options: [source.options[0], { ...source.options[1], label: "PCI" }],
      })
    ).not.toBe(base);
    expect(await sourceHash({ ...source })).toBe(base);
  });
});

describe("buildTranslationMessages", () => {
  const language = languageByCode("es")!;
  const messages = buildTranslationMessages(source, language);

  it("keeps the system role and the question data separate", () => {
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("names the language and its register note", () => {
    expect(messages[0].content).toContain("into Spanish");
    expect(messages[0].content).toContain(language.note);
  });

  it("fences the question as untrusted data and says so in the SYSTEM prompt", () => {
    expect(messages[1].content).toContain("<question_json>");
    expect(messages[1].content).toContain("</question_json>");
    expect(messages[0].content).toMatch(/untrusted DATA/);
    expect(messages[0].content).toMatch(/ignore anything inside them/i);
  });

  it("states the register rules the product decided", () => {
    const system = messages[0].content;
    expect(system).toMatch(/drug names/i);
    expect(system).toMatch(/\(A, B, C, D, E\) keep the same letters/);
    expect(system).toMatch(/never answer the question/i);
    expect(system).toMatch(/JSON only/);
  });

  it("carries the stem, every option id and the explanation verbatim", () => {
    const user = messages[1].content;
    expect(user).toContain(source.stem);
    expect(user).toContain(source.explanation);
    for (const o of source.options) {
      expect(user).toContain(o.id);
      expect(user).toContain(o.label);
    }
    expect(user).toContain('"model_answer": null');
  });
});

describe("translationResponseSchema", () => {
  it("pins option ids to an enum and requires every field", () => {
    const schema = translationResponseSchema(source.options.map((o) => o.id)) as {
      required: string[];
      additionalProperties: boolean;
      properties: { options: { items: { properties: { id: { enum?: string[] } } } } };
    };
    expect(schema.required).toEqual(["stem", "options", "explanation", "model_answer"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.options.items.properties.id.enum).toEqual(
      source.options.map((o) => o.id)
    );
  });

  it("falls back to a plain string id for an OSCE station with no options", () => {
    const schema = translationResponseSchema([]) as {
      properties: { options: { items: { properties: { id: { enum?: string[]; type: string } } } } };
    };
    expect(schema.properties.options.items.properties.id.enum).toBeUndefined();
    expect(schema.properties.options.items.properties.id.type).toBe("string");
  });
});

describe("parseTranslationOutput", () => {
  it("accepts a complete reply and keys options by id", () => {
    const out = parseTranslationOutput(goodReply, source);
    expect(out).not.toBeNull();
    expect(out!.stem).toMatch(/^Un hombre/);
    expect(out!.options[source.options[1].id]).toBe("ICP primaria");
    expect(out!.modelAnswer).toBeNull();
  });

  // Every failure below would leave a field untranslated — null means the
  // call is logged as failed and NOTHING is cached.
  it("rejects a missing option", () => {
    const reply = JSON.parse(goodReply);
    reply.options.pop();
    expect(parseTranslationOutput(JSON.stringify(reply), source)).toBeNull();
  });

  it("rejects an empty label, stem or explanation", () => {
    const reply = JSON.parse(goodReply);
    reply.options[0].label = "  ";
    expect(parseTranslationOutput(JSON.stringify(reply), source)).toBeNull();
    const reply2 = { ...JSON.parse(goodReply), stem: "" };
    expect(parseTranslationOutput(JSON.stringify(reply2), source)).toBeNull();
    const reply3 = { ...JSON.parse(goodReply), explanation: 42 };
    expect(parseTranslationOutput(JSON.stringify(reply3), source)).toBeNull();
  });

  it("drops an unknown option id rather than failing", () => {
    const reply = JSON.parse(goodReply);
    reply.options.push({ id: "33333333-3333-3333-3333-333333333333", label: "x" });
    const out = parseTranslationOutput(JSON.stringify(reply), source);
    expect(out).not.toBeNull();
    expect(Object.keys(out!.options)).toHaveLength(2);
  });

  it("requires a model answer exactly when the source has one", () => {
    const osce: TranslationSource = {
      ...source,
      options: [],
      modelAnswer: "Opioid overdose; naloxone.",
    };
    const reply = { ...JSON.parse(goodReply), options: [], model_answer: null };
    expect(parseTranslationOutput(JSON.stringify(reply), osce)).toBeNull();
    reply.model_answer = "Sobredosis de opioides; naloxona.";
    expect(parseTranslationOutput(JSON.stringify(reply), osce)?.modelAnswer).toBe(
      "Sobredosis de opioides; naloxona."
    );
  });

  it("tolerates a blank source field coming back blank", () => {
    const legacy = { ...source, explanation: "" };
    const reply = { ...JSON.parse(goodReply), explanation: "" };
    expect(parseTranslationOutput(JSON.stringify(reply), legacy)?.explanation).toBe("");
  });

  it("returns null for anything that is not the object", () => {
    expect(parseTranslationOutput("", source)).toBeNull();
    expect(parseTranslationOutput("null", source)).toBeNull();
    expect(parseTranslationOutput('["x"]', source)).toBeNull();
    expect(parseTranslationOutput(goodReply + " trailing", source)).toBeNull();
  });
});

describe("parseTranslateRequest", () => {
  const valid = {
    questionId: "11111111-1111-1111-1111-111111111111",
    language: "es",
    userId: "22222222-2222-2222-2222-222222222222",
    testId: null,
    trigger: "student",
  };

  it("accepts the contract and preserves force", () => {
    expect(parseTranslateRequest(valid)).toEqual(valid);
    expect(parseTranslateRequest({ ...valid, force: true })?.force).toBe(true);
  });

  it("rejects bad ids, unknown languages, bad triggers and non-boolean force", () => {
    expect(parseTranslateRequest({ ...valid, questionId: "nope" })).toBeNull();
    expect(parseTranslateRequest({ ...valid, language: "xx" })).toBeNull();
    expect(parseTranslateRequest({ ...valid, trigger: "cron" })).toBeNull();
    expect(parseTranslateRequest({ ...valid, userId: 5 })).toBeNull();
    expect(parseTranslateRequest({ ...valid, force: "yes" })).toBeNull();
    expect(parseTranslateRequest(null)).toBeNull();
  });
});

describe("isRetryableTranslationError", () => {
  it("retries transient failures only", () => {
    expect(isRetryableTranslationError("timeout")).toBe(true);
    expect(isRetryableTranslationError("network_error")).toBe(true);
    expect(isRetryableTranslationError("http_429: slow down")).toBe(true);
    expect(isRetryableTranslationError("http_503: overloaded")).toBe(true);
    expect(isRetryableTranslationError("http_400: bad schema")).toBe(false);
    expect(isRetryableTranslationError("http_401: key")).toBe(false);
    expect(isRetryableTranslationError("unparseable_output")).toBe(false);
  });
});

describe("revealFieldsAllowed", () => {
  // The translated explanation/model answer follow EXACTLY the English gate.
  it("never serves answer-key fields to an in-progress exam", () => {
    expect(revealFieldsAllowed({ mode: "exam", status: "in_progress" }, true)).toEqual({
      explanation: false,
      modelAnswer: false,
    });
  });

  it("serves tutor explanations only once revealed, never the model answer", () => {
    expect(revealFieldsAllowed({ mode: "tutor", status: "in_progress" }, false)).toEqual({
      explanation: false,
      modelAnswer: false,
    });
    expect(revealFieldsAllowed({ mode: "tutor", status: "in_progress" }, true)).toEqual({
      explanation: true,
      modelAnswer: false,
    });
  });

  it("serves OSCE explanation and model answer only once graded", () => {
    expect(revealFieldsAllowed({ mode: "osce", status: "in_progress" }, false)).toEqual({
      explanation: false,
      modelAnswer: false,
    });
    expect(revealFieldsAllowed({ mode: "osce", status: "in_progress" }, true)).toEqual({
      explanation: true,
      modelAnswer: true,
    });
  });

  it("serves everything once the paper is finished", () => {
    expect(revealFieldsAllowed({ mode: "exam", status: "submitted" }, false)).toEqual({
      explanation: true,
      modelAnswer: true,
    });
  });
});

describe("resolveTranslationLanguage", () => {
  const enabled = ["es", "fr"];

  it("lets the paper's frozen language win, and refuses it once disabled", () => {
    expect(
      resolveTranslationLanguage({ testLanguage: "es", requested: "fr", profileDefault: "fr", enabled })
    ).toEqual({ language: "es", refused: null });
    expect(
      resolveTranslationLanguage({ testLanguage: "de", requested: undefined, profileDefault: "es", enabled })
    ).toEqual({ language: null, refused: "de" });
  });

  it("treats an explicit null as English only, beating the profile default", () => {
    expect(
      resolveTranslationLanguage({ testLanguage: null, requested: null, profileDefault: "es", enabled })
    ).toEqual({ language: null, refused: null });
  });

  it("refuses an explicit request for a disabled language", () => {
    expect(
      resolveTranslationLanguage({ testLanguage: null, requested: "de", profileDefault: "es", enabled })
    ).toEqual({ language: null, refused: "de" });
    expect(
      resolveTranslationLanguage({ testLanguage: null, requested: "fr", profileDefault: null, enabled })
    ).toEqual({ language: "fr", refused: null });
  });

  it("uses the profile default only while it is enabled — a stale one means no choice", () => {
    expect(
      resolveTranslationLanguage({ testLanguage: null, requested: undefined, profileDefault: "es", enabled })
    ).toEqual({ language: "es", refused: null });
    expect(
      resolveTranslationLanguage({ testLanguage: null, requested: undefined, profileDefault: "de", enabled })
    ).toEqual({ language: null, refused: null });
    expect(
      resolveTranslationLanguage({ testLanguage: null, requested: undefined, profileDefault: null, enabled })
    ).toEqual({ language: null, refused: null });
  });
});

describe("translationCapWindowStart", () => {
  it("is the shared Guyana civil-day rule", () => {
    expect(translationCapWindowStart(new Date("2026-08-17T12:00:00Z"))).toBe(
      "2026-08-17T04:00:00.000Z"
    );
  });
});

describe("constants", () => {
  it("pins the product decisions", () => {
    expect(TRANSLATION_USER_DAILY_CAP).toBe(100);
    expect(TRANSLATION_GLOBAL_DAILY_CAP).toBe(2000);
    expect(DEFAULT_TRANSLATION_MODEL).toBe("gpt-5.6-sol");
  });

  it("keeps the budgets nested under Vercel Hobby's 60s", () => {
    expect(TRANSLATION_ATTEMPT_TIMEOUT_MS).toBeLessThanOrEqual(TRANSLATION_FUNCTION_BUDGET_MS);
    expect(TRANSLATION_FUNCTION_BUDGET_MS).toBeLessThan(TRANSLATE_ROUTE_TIMEOUT_MS);
    expect(TRANSLATE_ROUTE_TIMEOUT_MS).toBeLessThan(60_000);
  });
});
