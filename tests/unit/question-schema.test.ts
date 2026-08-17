import { describe, expect, it } from "vitest";
import {
  parseQuestionForm,
  questionSchema,
  subjectSchema,
} from "@/lib/validation";

// Matches the fixed-value ids in supabase/seed.sql — valid Postgres uuids
// that are NOT RFC-compliant v4. Guards the z.guid() choice against regression.
const SEED_SUBJECT = "11111111-1111-1111-1111-111111111111";
const V4 = "9f1c2b3e-7a4d-4c8b-9e2f-1a2b3c4d5e6f";

function question(overrides: Record<string, unknown> = {}) {
  return {
    subjectId: SEED_SUBJECT,
    type: "mcq_single",
    difficulty: "medium",
    stem: "A 58-year-old man presents with crushing central chest pain.",
    explanation: "Inferior leads localise to the right coronary artery.",
    imagePath: null,
    isPublished: false,
    options: [
      { label: "Right coronary artery", isCorrect: true },
      { label: "Left circumflex artery", isCorrect: false },
    ],
    ...overrides,
  };
}

describe("questionSchema", () => {
  it("accepts a valid single-answer question", () => {
    expect(questionSchema.safeParse(question()).success).toBe(true);
  });

  it("accepts seed-style uuids that are not RFC v4", () => {
    const r = questionSchema.safeParse(question({ subjectId: SEED_SUBJECT }));
    expect(r.success).toBe(true);
  });

  it("accepts standard v4 uuids", () => {
    expect(questionSchema.safeParse(question({ subjectId: V4 })).success).toBe(true);
  });

  describe("correct-answer cardinality", () => {
    it("rejects a single-answer question with two correct options", () => {
      const r = questionSchema.safeParse(
        question({
          options: [
            { label: "A", isCorrect: true },
            { label: "B", isCorrect: true },
          ],
        })
      );
      expect(r.success).toBe(false);
    });

    it("rejects a single-answer question with no correct option", () => {
      const r = questionSchema.safeParse(
        question({
          options: [
            { label: "A", isCorrect: false },
            { label: "B", isCorrect: false },
          ],
        })
      );
      expect(r.success).toBe(false);
    });

    it("rejects a multi question with only one correct option", () => {
      const r = questionSchema.safeParse(
        question({
          type: "mcq_multi",
          options: [
            { label: "A", isCorrect: true },
            { label: "B", isCorrect: false },
          ],
        })
      );
      expect(r.success).toBe(false);
      expect(r.error?.issues[0].message).toMatch(/at least two correct/i);
    });

    it("accepts a multi question with two correct options", () => {
      const r = questionSchema.safeParse(
        question({
          type: "mcq_multi",
          options: [
            { label: "A", isCorrect: true },
            { label: "B", isCorrect: true },
            { label: "C", isCorrect: false },
          ],
        })
      );
      expect(r.success).toBe(true);
    });

    it("treats image_based as single-answer", () => {
      const r = questionSchema.safeParse(
        question({
          type: "image_based",
          imagePath: "q/abc.png",
          options: [
            { label: "A", isCorrect: true },
            { label: "B", isCorrect: true },
          ],
        })
      );
      expect(r.success).toBe(false);
      expect(r.error?.issues[0].message).toMatch(/exactly one/i);
    });
  });

  it("requires an image for image_based questions", () => {
    const r = questionSchema.safeParse(
      question({ type: "image_based", imagePath: null })
    );
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path.includes("imagePath"))).toBe(true);
  });

  it("rejects fewer than two options", () => {
    const r = questionSchema.safeParse(
      question({ options: [{ label: "Only one", isCorrect: true }] })
    );
    expect(r.success).toBe(false);
  });

  it("rejects more than eight options", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      label: `Option ${i}`,
      isCorrect: i === 0,
    }));
    expect(questionSchema.safeParse(question({ options: many })).success).toBe(
      false
    );
  });

  it("rejects duplicate option text, case-insensitively", () => {
    const r = questionSchema.safeParse(
      question({
        options: [
          { label: "Aspirin", isCorrect: true },
          { label: "  aspirin ", isCorrect: false },
        ],
      })
    );
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.message === "Duplicate option text")).toBe(
      true
    );
  });

  it("rejects an empty stem or explanation", () => {
    expect(questionSchema.safeParse(question({ stem: "" })).success).toBe(false);
    expect(
      questionSchema.safeParse(question({ explanation: "short" })).success
    ).toBe(false);
  });

  it("rejects an option with empty text", () => {
    const r = questionSchema.safeParse(
      question({
        options: [
          { label: "Real", isCorrect: true },
          { label: "   ", isCorrect: false },
        ],
      })
    );
    expect(r.success).toBe(false);
  });

  it("carries an existing option id through", () => {
    const r = questionSchema.safeParse(
      question({
        options: [
          { id: V4, label: "Existing", isCorrect: true },
          { label: "New", isCorrect: false },
        ],
      })
    );
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.options[0].id).toBe(V4);
      expect(r.data.options[1].id).toBeUndefined();
    }
  });

  describe("osce", () => {
    const osce = (overrides: Record<string, unknown> = {}) =>
      question({
        type: "osce",
        options: [],
        modelAnswer:
          "Opioid overdose — support airway, give titrated naloxone.",
        ...overrides,
      });

    it("accepts a model answer with no options", () => {
      expect(questionSchema.safeParse(osce()).success).toBe(true);
    });

    it("rejects options on an OSCE question", () => {
      const r = questionSchema.safeParse(
        osce({ options: [{ label: "A", isCorrect: true }] })
      );
      expect(r.success).toBe(false);
      expect(r.error?.issues[0].message).toMatch(/model answer, not options/i);
    });

    it("requires a model answer of at least 10 characters", () => {
      expect(
        questionSchema.safeParse(osce({ modelAnswer: "" })).success
      ).toBe(false);
      const r = questionSchema.safeParse(osce({ modelAnswer: "too short" }));
      expect(r.success).toBe(false);
      expect(r.error?.issues.some((i) => i.path.includes("modelAnswer"))).toBe(
        true
      );
    });

    it("rejects a stray model answer on an MCQ question", () => {
      const r = questionSchema.safeParse(
        question({ modelAnswer: "This does not belong on an MCQ." })
      );
      expect(r.success).toBe(false);
      expect(r.error?.issues[0].message).toMatch(/only osce/i);
    });

    it("defaults modelAnswer to empty when absent (legacy forms)", () => {
      const r = questionSchema.safeParse(question());
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.modelAnswer).toBe("");
    });
  });
});

describe("parseQuestionForm", () => {
  function form(entries: Record<string, string>) {
    const fd = new FormData();
    Object.entries(entries).forEach(([k, v]) => fd.set(k, v));
    return fd;
  }

  it("parses a complete form into a valid question", () => {
    const fd = form({
      subjectId: SEED_SUBJECT,
      type: "mcq_single",
      difficulty: "hard",
      stem: "A 29-year-old at 34 weeks gestation presents with hypertension.",
      explanation: "Magnesium sulfate prevents eclamptic seizures.",
      isPublished: "on",
      options: JSON.stringify([
        { label: "Magnesium sulfate", isCorrect: true },
        { label: "Labetalol", isCorrect: false },
      ]),
    });

    const parsed = questionSchema.safeParse(parseQuestionForm(fd));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.isPublished).toBe(true);
      expect(parsed.data.difficulty).toBe("hard");
      expect(parsed.data.options).toHaveLength(2);
    }
  });

  it("treats a missing isPublished checkbox as draft", () => {
    const fd = form({
      subjectId: SEED_SUBJECT,
      type: "mcq_single",
      difficulty: "medium",
      stem: "A stem long enough to pass validation checks.",
      explanation: "An explanation long enough to pass.",
      options: JSON.stringify([
        { label: "A", isCorrect: true },
        { label: "B", isCorrect: false },
      ]),
    });
    const parsed = questionSchema.safeParse(parseQuestionForm(fd));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.isPublished).toBe(false);
  });

  it("normalises an empty imagePath to null", () => {
    const fd = form({ imagePath: "   " });
    const out = parseQuestionForm(fd) as { imagePath: unknown };
    expect(out.imagePath).toBeNull();
  });

  it("survives malformed options JSON without throwing", () => {
    const fd = form({ options: "{not json" });
    expect(() => parseQuestionForm(fd)).not.toThrow();
    const out = parseQuestionForm(fd) as { options: unknown };
    expect(out.options).toEqual([]);
  });
});

describe("subjectSchema", () => {
  it("accepts valid names", () => {
    expect(
      subjectSchema.safeParse({ specialtyId: SEED_SUBJECT, name: "Medicine" })
        .success
    ).toBe(true);
  });

  it("requires a specialty for subjects", () => {
    expect(subjectSchema.safeParse({ name: "Medicine" }).success).toBe(false);
  });

  it("trims and rejects names that are too short", () => {
    expect(
      subjectSchema.safeParse({ specialtyId: SEED_SUBJECT, name: " M " }).success
    ).toBe(false);
  });
});
