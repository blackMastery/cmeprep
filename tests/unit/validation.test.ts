import { describe, expect, it } from "vitest";
import { createTestSchema, saveAnswersSchema } from "@/lib/validation";

// Matches the fixed-value ids used in supabase/seed.sql. These are valid
// Postgres uuids but are NOT RFC-compliant v4 values, which is exactly the
// case that must keep working.
const SEED_SUBJECT = "11111111-1111-1111-1111-111111111111";
const V4 = "9f1c2b3e-7a4d-4c8b-9e2f-1a2b3c4d5e6f";

describe("createTestSchema", () => {
  const valid = {
    examId: "e0000000-0000-0000-0000-000000000001",
    subjectIds: [SEED_SUBJECT],
    topicIds: [],
    difficulty: "mixed",
    numQuestions: 10,
    durationMin: 15,
  };

  it("requires an exam id", () => {
    const { examId: _omitted, ...withoutExam } = valid;
    expect(createTestSchema.safeParse(withoutExam).success).toBe(false);
  });

  it("accepts seed-style uuids that are not RFC v4", () => {
    expect(createTestSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts standard v4 uuids", () => {
    expect(
      createTestSchema.safeParse({ ...valid, subjectIds: [V4] }).success
    ).toBe(true);
  });

  it("rejects a non-uuid string", () => {
    expect(
      createTestSchema.safeParse({ ...valid, subjectIds: ["not-a-uuid"] })
        .success
    ).toBe(false);
  });

  it("requires at least one subject", () => {
    expect(
      createTestSchema.safeParse({ ...valid, subjectIds: [] }).success
    ).toBe(false);
  });

  it("rejects out-of-range question counts", () => {
    expect(
      createTestSchema.safeParse({ ...valid, numQuestions: 1 }).success
    ).toBe(false);
    expect(
      createTestSchema.safeParse({ ...valid, numQuestions: 500 }).success
    ).toBe(false);
  });

  it("rejects an unreasonable duration", () => {
    expect(
      createTestSchema.safeParse({ ...valid, durationMin: 1000 }).success
    ).toBe(false);
  });
});

describe("saveAnswersSchema", () => {
  it("accepts a batch of answers", () => {
    const result = saveAnswersSchema.safeParse({
      answers: [
        { questionId: SEED_SUBJECT, selectedOptionIds: [V4], flagged: true },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty selection (a cleared answer)", () => {
    expect(
      saveAnswersSchema.safeParse({
        answers: [{ questionId: V4, selectedOptionIds: [] }],
      }).success
    ).toBe(true);
  });

  it("rejects an empty batch", () => {
    expect(saveAnswersSchema.safeParse({ answers: [] }).success).toBe(false);
  });
});
