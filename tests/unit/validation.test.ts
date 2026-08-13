import { describe, expect, it } from "vitest";
import {
  createPaypalOrderSchema,
  createTestSchema,
  emailSchema,
  fullNameSchema,
  parseFeatureLines,
  parseInviteEmails,
  passwordSchema,
  planSchema,
  safeRedirectPath,
  saveAnswersSchema,
  subscriptionSchema,
  trialsLimitSchema,
  userRoleSchema,
} from "@/lib/validation";

// Matches the fixed-value ids used in supabase/seed.sql. These are valid
// Postgres uuids but are NOT RFC-compliant v4 values, which is exactly the
// case that must keep working.
const SEED_SUBJECT = "11111111-1111-1111-1111-111111111111";
const SEED_EXAM = "e0000000-0000-0000-0000-000000000001";
const V4 = "9f1c2b3e-7a4d-4c8b-9e2f-1a2b3c4d5e6f";

describe("createTestSchema", () => {
  const valid = {
    examId: "e0000000-0000-0000-0000-000000000001",
    subjectIds: [SEED_SUBJECT],
    difficulty: "mixed",
    numQuestions: 10,
    durationMin: 15,
  };

  it("requires an exam id", () => {
    expect(
      createTestSchema.safeParse({ ...valid, examId: undefined }).success
    ).toBe(false);
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

describe("admin user & subscription schemas", () => {
  it("userRoleSchema accepts known roles and rejects unknown", () => {
    expect(userRoleSchema.safeParse("student").success).toBe(true);
    expect(userRoleSchema.safeParse("superadmin").success).toBe(false);
  });

  it("trialsLimitSchema coerces strings and enforces 0-1000 integers", () => {
    expect(trialsLimitSchema.safeParse("0").success).toBe(true);
    expect(trialsLimitSchema.safeParse("1000").success).toBe(true);
    expect(trialsLimitSchema.safeParse("1001").success).toBe(false);
    expect(trialsLimitSchema.safeParse("-1").success).toBe(false);
    expect(trialsLimitSchema.safeParse("2.5").success).toBe(false);
    // The documented footgun: "" coerces to 0 — actions must reject empty
    // input BEFORE parsing. This pins the behavior the guard exists for.
    expect(trialsLimitSchema.safeParse("").success).toBe(true);
  });

  it("subscriptionSchema accepts preset and custom plans with a valid date", () => {
    const base = {
      planId: null,
      examId: SEED_EXAM,
      status: "active",
      currentPeriodEnd: "2026-08-21",
    };
    expect(
      subscriptionSchema.safeParse({ plan: "1 month", ...base }).success
    ).toBe(true);
    expect(
      subscriptionSchema.safeParse({ plan: "Scholarship 6 months", ...base })
        .success
    ).toBe(true);
  });

  it("subscriptionSchema treats a null exam as the all-access grant", () => {
    const base = { plan: "1 month", planId: null, status: "active" as const };
    expect(
      subscriptionSchema.safeParse({
        ...base,
        examId: null,
        currentPeriodEnd: "2026-08-21",
      }).success
    ).toBe(true);

    // "" must be mapped to null by the action BEFORE parsing — if it ever
    // reaches the schema that is a bug, so it has to fail loudly.
    expect(
      subscriptionSchema.safeParse({
        ...base,
        examId: "",
        currentPeriodEnd: "2026-08-21",
      }).success
    ).toBe(false);
  });

  it("subscriptionSchema rejects short plans, bad statuses and bad dates", () => {
    const base = {
      planId: null,
      examId: SEED_EXAM,
      status: "active",
      currentPeriodEnd: "2026-08-21",
    };
    expect(subscriptionSchema.safeParse({ plan: "x", ...base }).success).toBe(
      false
    );
    expect(
      subscriptionSchema.safeParse({
        ...base,
        plan: "1 month",
        status: "paused",
      }).success
    ).toBe(false);
    expect(
      subscriptionSchema.safeParse({
        ...base,
        plan: "1 month",
        currentPeriodEnd: "2026-13-40",
      }).success
    ).toBe(false);
    expect(
      subscriptionSchema.safeParse({
        ...base,
        plan: "1 month",
        currentPeriodEnd: "next tuesday",
      }).success
    ).toBe(false);
  });
});

describe("createPaypalOrderSchema", () => {
  it("requires both a plan and an exam", () => {
    expect(
      createPaypalOrderSchema.safeParse({ planId: V4, examId: SEED_EXAM })
        .success
    ).toBe(true);
    // All-access is no longer purchasable — the exam is mandatory.
    expect(createPaypalOrderSchema.safeParse({ planId: V4 }).success).toBe(
      false
    );
    expect(
      createPaypalOrderSchema.safeParse({ planId: V4, examId: null }).success
    ).toBe(false);
  });

  it("accepts the seed exam id, which is not RFC v4", () => {
    // Guards the z.guid() vs z.uuid() choice: z.uuid() rejects this id.
    expect(
      createPaypalOrderSchema.safeParse({ planId: V4, examId: SEED_EXAM })
        .success
    ).toBe(true);
  });

  it("rejects a non-uuid exam id", () => {
    expect(
      createPaypalOrderSchema.safeParse({ planId: V4, examId: "camc" }).success
    ).toBe(false);
  });
});

describe("planSchema", () => {
  const valid = {
    name: "6 months",
    priceDollars: "360",
    period: "six months access",
    description: "The long run-up.",
    durationMonths: "6",
    features: ["Everything in 3 months", "Half a year of access"],
  };

  it("accepts a full plan and coerces dollar strings", () => {
    const parsed = planSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.priceDollars).toBe(360);
      expect(parsed.data.durationMonths).toBe(6);
    }
  });

  it("accepts a free tier (price 0, null duration, empty description)", () => {
    expect(
      planSchema.safeParse({
        ...valid,
        priceDollars: "0",
        durationMonths: null,
        description: "",
      }).success
    ).toBe(true);
  });

  it("rejects short names, negative prices and out-of-range durations", () => {
    expect(planSchema.safeParse({ ...valid, name: "x" }).success).toBe(false);
    expect(
      planSchema.safeParse({ ...valid, priceDollars: "-1" }).success
    ).toBe(false);
    expect(
      planSchema.safeParse({ ...valid, durationMonths: "0" }).success
    ).toBe(false);
    expect(
      planSchema.safeParse({ ...valid, durationMonths: "37" }).success
    ).toBe(false);
  });

  it("caps features at eight lines of eighty characters", () => {
    expect(
      planSchema.safeParse({
        ...valid,
        features: Array.from({ length: 9 }, (_, i) => `Feature ${i}`),
      }).success
    ).toBe(false);
    expect(
      planSchema.safeParse({ ...valid, features: ["y".repeat(81)] }).success
    ).toBe(false);
  });
});

describe("parseFeatureLines", () => {
  it("splits lines, trims, and drops empties", () => {
    expect(parseFeatureLines("  One \n\n Two\r\n   \nThree  ")).toEqual([
      "One",
      "Two",
      "Three",
    ]);
    expect(parseFeatureLines("")).toEqual([]);
  });
});

describe("emailSchema", () => {
  it("trims and lower-cases so logins are case-insensitive", () => {
    expect(emailSchema.parse("  Doctor.Test@Example.COM  ")).toBe(
      "doctor.test@example.com"
    );
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["", "not-an-email", "nope@", "@example.com", "a b@c.com"]) {
      expect(emailSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("passwordSchema", () => {
  it("requires eight characters", () => {
    expect(passwordSchema.safeParse("1234567").success).toBe(false);
    expect(passwordSchema.safeParse("12345678").success).toBe(true);
  });

  it("does not trim — leading and trailing spaces are part of the secret", () => {
    expect(passwordSchema.parse("  spaced  ")).toBe("  spaced  ");
  });
});

describe("fullNameSchema", () => {
  it("trims and enforces a sane length", () => {
    expect(fullNameSchema.parse("  Dr. Anita Persaud  ")).toBe(
      "Dr. Anita Persaud"
    );
    expect(fullNameSchema.safeParse("A").success).toBe(false);
    expect(fullNameSchema.safeParse("x".repeat(121)).success).toBe(false);
  });
});

describe("safeRedirectPath", () => {
  it("keeps ordinary in-app destinations", () => {
    expect(safeRedirectPath("/checkout/abc?exam=1")).toBe("/checkout/abc?exam=1");
    expect(safeRedirectPath("/dashboard")).toBe("/dashboard");
  });

  it("rejects protocol-relative targets that walk off the site", () => {
    // The whole point: these all pass a bare startsWith("/") check.
    expect(safeRedirectPath("//evil.com")).toBe("/dashboard");
    expect(safeRedirectPath("//evil.com/path")).toBe("/dashboard");
    expect(safeRedirectPath("/\\evil.com")).toBe("/dashboard");
  });

  it("rejects absolute urls and junk", () => {
    expect(safeRedirectPath("https://evil.com")).toBe("/dashboard");
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/dashboard");
    expect(safeRedirectPath("dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("")).toBe("/dashboard");
    expect(safeRedirectPath(null)).toBe("/dashboard");
    expect(safeRedirectPath(undefined)).toBe("/dashboard");
  });

  it("honours a custom fallback", () => {
    expect(safeRedirectPath("//evil.com", "/login")).toBe("/login");
  });
});

describe("parseInviteEmails", () => {
  it("splits on newlines, commas, semicolons and spaces", () => {
    expect(
      parseInviteEmails("a@x.org, b@x.org;c@x.org\nd@x.org e@x.org").emails
    ).toEqual(["a@x.org", "b@x.org", "c@x.org", "d@x.org", "e@x.org"]);
  });

  it("dedupes case-insensitively — the column is citext", () => {
    const { emails } = parseInviteEmails("Jane@X.org jane@x.org");
    expect(emails).toEqual(["jane@x.org"]);
  });

  it("reports invalid tokens instead of dropping them silently", () => {
    const { emails, invalid } = parseInviteEmails("a@x.org not-an-email");
    expect(emails).toEqual(["a@x.org"]);
    expect(invalid).toEqual(["not-an-email"]);
  });

  it("returns nothing for an empty paste", () => {
    expect(parseInviteEmails("  \n ")).toEqual({ emails: [], invalid: [] });
  });
});
