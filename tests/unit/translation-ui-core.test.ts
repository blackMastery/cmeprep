import { describe, expect, it } from "vitest";
import {
  enabledRegistry,
  optionTranslation,
  parseShownRecord,
  requestableLanguages,
  seedReviewTranslations,
  seedTakeTranslations,
  serializeShownRecord,
  translateButtonLabel,
  translateButtonParts,
  translateErrorFor,
  translatedAttrs,
  translationFromReview,
  translationFromTake,
  translationStorageKey,
} from "@/lib/translation-ui-core";
import type { ReviewQuestion } from "@/lib/results";
import type { TakeQuestion } from "@/lib/tests";

describe("shown record", () => {
  it("survives garbage, older shapes and a round trip", () => {
    expect(parseShownRecord(null)).toEqual({ shown: [], noticeDismissed: false });
    expect(parseShownRecord("{not json")).toEqual({ shown: [], noticeDismissed: false });
    expect(parseShownRecord('{"shown":"x"}')).toEqual({ shown: [], noticeDismissed: false });
    expect(parseShownRecord('{"shown":["a",1,"b"],"noticeDismissed":"yes"}')).toEqual({
      shown: ["a", "b"],
      noticeDismissed: false,
    });
    const record = { shown: ["q1"], noticeDismissed: true };
    expect(parseShownRecord(serializeShownRecord(record))).toEqual(record);
  });

  it("keys storage per test", () => {
    expect(translationStorageKey("t1")).toBe("cmeprep.translation.t1");
  });
});

describe("translateButtonLabel", () => {
  it("names the language in its own script", () => {
    expect(translateButtonLabel("es", "idle")).toBe("Translate to Español");
    expect(translateButtonLabel(null, "idle")).toBe("Translate");
    expect(translateButtonLabel("es", "pending")).toBe("Translating…");
    expect(translateButtonLabel("es", "error")).toBe("Retry translation");
    expect(translateButtonLabel("es", "shown")).toBe("Show original");
    expect(translateButtonLabel("es", "original")).toBe("Show Español");
  });
});

describe("translatedAttrs", () => {
  it("adds nothing for English", () => {
    expect(translatedAttrs(null)).toEqual({});
  });

  it("sets lang and dir only — fonts ride on the tokens", () => {
    expect(translatedAttrs("es")).toEqual({ lang: "es", dir: "ltr" });
    expect(translatedAttrs("ar")).toEqual({ lang: "ar", dir: "rtl" });
  });
});

describe("translateButtonParts", () => {
  it("splits the native name out so it can carry its own lang/dir", () => {
    expect(translateButtonParts("es", "idle")).toEqual({
      prefix: "Translate to ",
      name: "Español",
    });
    expect(translateButtonParts("es", "original")).toEqual({
      prefix: "Show ",
      name: "Español",
    });
    expect(translateButtonParts(null, "idle")).toEqual({
      prefix: "Translate",
      name: null,
    });
    expect(translateButtonParts("es", "shown").name).toBeNull();
  });
});

describe("optionTranslation", () => {
  const shown = { language: "es", stem: "x", options: { o1: "Uno" } };

  it("uses the translation when the row has this option", () => {
    expect(optionTranslation(shown, { id: "o1", label: "One" })).toEqual({
      label: "Uno",
      translated: { language: "es" },
    });
  });

  it("keeps English for an option the row never saw, and when nothing is shown", () => {
    expect(optionTranslation(shown, { id: "o2", label: "Two" })).toEqual({
      label: "Two",
      translated: null,
    });
    expect(optionTranslation(null, { id: "o1", label: "One" })).toEqual({
      label: "One",
      translated: null,
    });
  });
});

describe("registry views", () => {
  it("splits enabled from requestable in registry order", () => {
    expect(enabledRegistry(["fr", "es"]).map((l) => l.code)).toEqual(["es", "fr"]);
    expect(requestableLanguages(["es"]).map((l) => l.code)).not.toContain("es");
    expect(requestableLanguages(["es"]).map((l) => l.code)).toContain("ar");
  });
});

describe("translateErrorFor", () => {
  it("maps the route's outcomes to one UI reaction each", () => {
    expect(translateErrorFor(409, { error: "language_required" })).toEqual({
      kind: "language_required",
    });
    expect(translateErrorFor(429, { message: "busy" })).toEqual({
      kind: "capped",
      message: "busy",
    });
    expect(translateErrorFor(400, { error: "language_not_enabled" }).kind).toBe("disabled");
    expect(translateErrorFor(500, "nope").kind).toBe("error");
  });

  it("treats 502/503 as a plain retryable error with the 'showing English' copy", () => {
    expect(translateErrorFor(502, {})).toEqual({
      kind: "error",
      message: "Translation is unavailable right now — showing English.",
    });
    expect(translateErrorFor(503, null).kind).toBe("error");
    expect(translateErrorFor(502, { message: "custom" })).toEqual({
      kind: "error",
      message: "custom",
    });
  });
});

describe("adapters", () => {
  const take = {
    questionId: "q1",
    translation: { language: "es", stem: "Tallo", options: { o1: "Uno" } },
    reveal: null,
  } as unknown as TakeQuestion;

  it("merges the take page's cached fields with the reveal's translated ones", () => {
    expect(translationFromTake(take)).toEqual({
      language: "es",
      stem: "Tallo",
      options: { o1: "Uno" },
    });
    const revealed = {
      ...take,
      reveal: { translatedExplanation: "Porque" },
    } as unknown as TakeQuestion;
    expect(translationFromTake(revealed)?.explanation).toBe("Porque");
    expect(translationFromTake({ ...take, translation: null } as TakeQuestion)).toBeNull();
  });

  it("seeds a map keyed by question id, skipping questions with nothing cached", () => {
    const seeded = seedTakeTranslations([
      take,
      { ...take, questionId: "q2", translation: null } as unknown as TakeQuestion,
    ]);
    expect([...seeded.keys()]).toEqual(["q1"]);
    const review = {
      questionId: "r1",
      withheld: false,
      translation: { language: "es", stem: "T", options: {}, explanation: "E", modelAnswer: null },
    } as unknown as ReviewQuestion;
    expect(seedReviewTranslations([review]).get("r1")?.explanation).toBe("E");
  });

  it("never shows a withheld question's translation in review", () => {
    const review = {
      withheld: false,
      translation: {
        language: "es",
        stem: "Tallo",
        options: {},
        explanation: "Porque",
        modelAnswer: null,
      },
    } as unknown as ReviewQuestion;
    expect(translationFromReview(review)).toEqual({
      language: "es",
      stem: "Tallo",
      options: {},
      explanation: "Porque",
    });
    expect(
      translationFromReview({ ...review, withheld: true } as ReviewQuestion)
    ).toBeNull();
  });
});
