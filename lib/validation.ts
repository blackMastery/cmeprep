import { z } from "zod";

import { OSCE_MAX_ANSWER_CHARS } from "@/lib/osce-grading-core";

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;

// Use z.guid(), not z.uuid(). Zod's z.uuid() enforces the RFC 9562 version
// and variant bits, but Postgres's `uuid` type accepts any 8-4-4-4-12 hex
// value — so strict validation would reject IDs the database happily stores
// (fixed-value seed ids, UUIDv7, etc). Match the database's definition.
export const uuid = () => z.guid();

export const TEST_MODES = ["exam", "tutor", "osce"] as const;
export const testModeSchema = z.enum(TEST_MODES);

/** Assignments prescribe MCQ tests only — an org can't launch a member into
 * an AI-graded OSCE session (per-answer OpenAI cost, no assignment UI for it). */
export const ASSIGNMENT_MODES = ["exam", "tutor"] as const;
export const assignmentModeSchema = z.enum(ASSIGNMENT_MODES);

export const createTestSchema = z
  .object({
    examId: uuid(),
    subjectIds: z.array(uuid()).min(1, "Choose at least one subject"),
    difficulty: z.enum([...DIFFICULTIES, "mixed"]).default("mixed"),
    numQuestions: z.number().int().min(5).max(100),
    mode: testModeSchema.default("exam"),
    // Required for exam mode (superRefine); tutor sessions are untimed —
    // a stray durationMin on a tutor request is accepted and ignored, so an
    // older client can't be locked out by sending it.
    durationMin: z.number().int().min(5).max(240).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "exam" && v.durationMin === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["durationMin"],
        message: "Pick a time limit",
      });
    }
  });

export type CreateTestInput = z.infer<typeof createTestSchema>;

/**
 * POST /api/tests/[id]/reveal — tutor mode's "commit this answer" call.
 * Carries the selection itself so grading never depends on the autosave
 * PATCH having landed first.
 */
export const revealAnswerSchema = z.object({
  questionId: uuid(),
  selectedOptionIds: z.array(uuid()).min(1, "Select an answer").max(10),
  timeSpentSec: z.number().int().min(0).max(86_400).optional(),
});

export const saveAnswerSchema = z.object({
  questionId: uuid(),
  selectedOptionIds: z.array(uuid()).max(10),
  /** OSCE staging only; MCQ runners never send it. */
  answerText: z.string().max(OSCE_MAX_ANSWER_CHARS).optional(),
  flagged: z.boolean().optional(),
  timeSpentSec: z.number().int().min(0).max(86_400).optional(),
});

/** Batch shape used by the beacon on page unload. */
export const saveAnswersSchema = z.object({
  answers: z.array(saveAnswerSchema).min(1).max(100),
});

/**
 * POST /api/tests/[id]/grade — OSCE's "commit this answer" call. Like the
 * tutor reveal, it carries the answer itself so grading never depends on the
 * autosave PATCH having landed first. The minimum-length rule lives in
 * validateAnswerText (osce-grading-core) so route and UI share one message.
 */
export const gradeAnswerSchema = z.object({
  questionId: uuid(),
  answerText: z.string().min(1, "Type an answer").max(OSCE_MAX_ANSWER_CHARS),
  timeSpentSec: z.number().int().min(0).max(86_400).optional(),
});

/** POST /api/tests/[id]/report-grade — "this AI grade looks wrong". */
export const reportGradeSchema = z.object({
  questionId: uuid(),
  note: z.string().trim().max(1000, "Keep the note under 1000 characters").optional(),
});

// ── Admin content schemas ───────────────────────────────────

export const QUESTION_TYPES = [
  "mcq_single",
  "mcq_multi",
  "image_based",
  "osce",
] as const;

export const questionOptionSchema = z.object({
  /** Absent on newly added rows; present when editing an existing option. */
  id: uuid().optional(),
  label: z.string().trim().min(1, "Every option needs text").max(500),
  isCorrect: z.boolean(),
});

export const questionSchema = z
  .object({
    subjectId: uuid(),
    type: z.enum(QUESTION_TYPES),
    difficulty: z.enum(DIFFICULTIES),
    stem: z.string().trim().min(10, "Write the question stem"),
    explanation: z.string().trim().min(10, "Explain the answer"),
    imagePath: z.string().trim().min(1).max(3000).nullable().default(null),
    isPublished: z.boolean().default(false),
    // The two-option floor is per-type (superRefine): OSCE questions carry
    // NO options at all — their answer key is modelAnswer.
    options: z
      .array(questionOptionSchema)
      .max(8, "Eight options is the maximum"),
    /** OSCE only: the answer key the AI judge grades against. */
    modelAnswer: z
      .string()
      .trim()
      .max(10_000, "Keep the model answer under 10,000 characters")
      .default(""),
  })
  .superRefine((v, ctx) => {
    const correct = v.options.filter((o) => o.isCorrect).length;

    if (v.type === "osce") {
      if (v.options.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["options"],
          message: "OSCE questions take a model answer, not options",
        });
      }
      if (v.modelAnswer.length < 10) {
        ctx.addIssue({
          code: "custom",
          path: ["modelAnswer"],
          message: "Write the model answer",
        });
      }
    } else if (v.modelAnswer.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["modelAnswer"],
        message: "Only OSCE questions take a model answer",
      });
    } else if (v.options.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "Add at least two options",
      });
    } else if (v.type === "mcq_multi") {
      // `image_based` is a single-answer question that happens to carry an
      // image — the renderer keys "multi" off `type === "mcq_multi"` only.
      if (correct < 2) {
        ctx.addIssue({
          code: "custom",
          path: ["options"],
          message: "Multi-answer questions need at least two correct options",
        });
      }
    } else if (correct !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "Choose exactly one correct option",
      });
    }

    if (v.type === "image_based" && !v.imagePath) {
      ctx.addIssue({
        code: "custom",
        path: ["imagePath"],
        message: "Image questions need an uploaded image",
      });
    }

    const seen = new Set<string>();
    v.options.forEach((o, i) => {
      const key = o.label.trim().toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["options", i, "label"],
          message: "Duplicate option text",
        });
      }
      seen.add(key);
    });
  });

export type QuestionInput = z.infer<typeof questionSchema>;

/**
 * Ids for a bulk action on the questions list.
 *
 * Capped at one page (lib/admin/questions.ts PAGE_SIZE) because selection is
 * page-scoped — anything larger arrived by hand-crafting the request, not by
 * ticking boxes, and a bulk delete is not something to accept on trust.
 */
export const bulkQuestionIdsSchema = z
  .array(uuid())
  .min(1, "Select at least one question")
  .max(20, "Too many questions for one action");

export const examSchema = z.object({
  name: z.string().trim().min(2, "Exam name is too short").max(80),
  code: z.string().trim().max(20, "Code is too long").optional(),
});

export const specialtySchema = z.object({
  examId: uuid(),
  name: z.string().trim().min(2, "Specialty name is too short").max(80),
});

export const subjectSchema = z.object({
  specialtyId: uuid(),
  name: z.string().trim().min(2, "Subject name is too short").max(80),
});

/**
 * FormData → plain object, kept pure so it can be unit-tested.
 *
 * Option rows travel as one JSON blob rather than indexed field names
 * (`option-0-label`): add/remove/reorder already requires JS, so there is no
 * progressive-enhancement left to protect, and JSON round-trips exactly.
 */
export function parseQuestionForm(fd: FormData): unknown {
  let options: unknown = [];
  const raw = fd.get("options");
  if (typeof raw === "string" && raw.length > 0) {
    try {
      options = JSON.parse(raw);
    } catch {
      options = [];
    }
  }

  const imagePath = String(fd.get("imagePath") ?? "").trim();

  return {
    subjectId: String(fd.get("subjectId") ?? ""),
    type: String(fd.get("type") ?? ""),
    difficulty: String(fd.get("difficulty") ?? ""),
    stem: String(fd.get("stem") ?? ""),
    explanation: String(fd.get("explanation") ?? ""),
    imagePath: imagePath.length > 0 ? imagePath : null,
    isPublished: fd.get("isPublished") === "on" || fd.get("isPublished") === "true",
    options,
    modelAnswer: String(fd.get("modelAnswer") ?? ""),
  };
}

/* ── Admin: users & subscriptions ──────────────────────────────── */

export const USER_ROLES = ["trial", "student", "admin"] as const;
export const userRoleSchema = z.enum(USER_ROLES);

/**
 * NOTE: z.coerce turns "" into 0 — actions must reject empty input BEFORE
 * parsing, or an empty field silently zeroes the limit.
 */
export const trialsLimitSchema = z.coerce
  .number()
  .int("Whole numbers only")
  .min(0, "Cannot be negative")
  .max(1000, "That's more than anyone needs");

export const SUB_STATUSES = ["active", "expired", "cancelled"] as const;

/** Textarea → feature list: one per line, trimmed, empties dropped. */
export function parseFeatureLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export const planSchema = z.object({
  name: z.string().trim().min(2, "Plan name is too short").max(40),
  // Dollars in the form, cents in the database.
  priceDollars: z.coerce
    .number()
    .min(0, "Price cannot be negative")
    .max(10000, "That price looks wrong"),
  period: z.string().trim().min(2, "Add a billing period line").max(60),
  description: z.string().trim().max(200, "Keep the description short"),
  // Optional; actions convert "" to null BEFORE parsing (coerce footgun).
  durationMonths: z.coerce
    .number()
    .int("Whole months only")
    .min(1, "At least one month")
    .max(36, "That's too long")
    .nullable(),
  features: z
    .array(z.string().trim().min(1).max(80, "Feature lines are capped at 80 characters"))
    .max(8, "Eight feature lines at most"),
});

export const subscriptionSchema = z.object({
  plan: z
    .string()
    .trim()
    .min(2, "Plan name is too short")
    .max(40, "Plan name is too long"),
  /** Soft link to plans; null for bespoke grants. Actions map "" → null. */
  planId: uuid().nullable(),
  /**
   * null = ALL-ACCESS. Only an admin can grant that, and only deliberately —
   * actions map "" → null BEFORE parsing, per the coerce convention above.
   */
  examId: uuid().nullable(),
  status: z.enum(SUB_STATUSES),
  // <input type="date"> value; the action converts to `${d}T23:59:59Z` —
  // end-of-day UTC so the chosen date is the last day WITH access.
  currentPeriodEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an end date")
    .refine((d) => !Number.isNaN(Date.parse(d)), "Invalid date"),
});

/** POST /api/paypal/orders — the amount comes from the DB, never the body. */
export const createPaypalOrderSchema = z.object({
  planId: uuid(),
  // Required: self-serve checkout always buys exactly one exam. All-access is
  // no longer purchasable — only an admin can grant it.
  examId: uuid(),
});

/* ── Account / auth ─────────────────────────────────────────────── */

/**
 * Sanitise a user-supplied post-login destination.
 *
 * A bare `startsWith("/")` check is not enough: "//evil.com" passes it, and
 * browsers resolve a protocol-relative Location straight off the site. Also
 * rejects "/\evil.com", which some browsers normalise to the same thing.
 */
export function safeRedirectPath(next: unknown, fallback = "/dashboard"): string {
  if (typeof next !== "string" || next === "") return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address");

/** Social sign-in providers enabled in Supabase. Adding one here is not
 *  enough — it must also be enabled in config.toml AND in the hosted
 *  project, or the redirect fails at Supabase rather than in this schema.
 *  (LinkedIn was removed pending developer-app approval; if it returns it
 *  must be the `linkedin_oidc` variant — Supabase dropped the legacy
 *  `linkedin` provider in Jan 2024.) */
export const OAUTH_PROVIDERS = ["google"] as const;
export const oauthProviderSchema = z.enum(OAUTH_PROVIDERS);

/**
 * Carries the post-login destination across the OAuth round-trip. Supabase
 * matches `redirect_to` against its allow-list INCLUDING the query string,
 * and `next` is dynamic (/checkout/<uuid>, …), so it can't ride the callback
 * URL — an unlisted target silently falls back to site_url, stranding the
 * auth code on the homepage.
 */
export const OAUTH_NEXT_COOKIE = "oauth_next";

/* ── Contact form ───────────────────────────────────────────────── */

export const CONTACT_SUBJECTS = [
  "General enquiry",
  "Billing or payment",
  "Technical problem",
  "Question or content feedback",
  "Teams & enterprise",
  "Other",
] as const;

/**
 * Public, unauthenticated input — the only schema in this file that anyone on
 * the internet can reach, so the length caps are the real defence rather than
 * a UX nicety.
 */
export const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter your name")
    .max(120, "That name is too long"),
  email: emailSchema,
  subject: z.enum(CONTACT_SUBJECTS, { message: "Pick a subject" }),
  body: z
    .string()
    .trim()
    .min(20, "Tell us a little more — 20 characters at least")
    .max(4000, "Keep it under 4000 characters"),
});

export type ContactInput = z.infer<typeof contactSchema>;

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters");

/* ── Orgs ───────────────────────────────────────────────────────── */

export const ORG_MEMBER_ROLES = ["member", "admin"] as const;
export const orgMemberRoleSchema = z.enum(ORG_MEMBER_ROLES);

export const orgNameSchema = z
  .string()
  .trim()
  .min(2, "Enter your organisation's name")
  .max(120, "Keep the name under 120 characters");

/** Bounds mirror the org_departments name check constraint (2–80). */
export const orgDepartmentNameSchema = z
  .string()
  .trim()
  .min(2, "Give the department a name")
  .max(80, "Keep the name under 80 characters");

/**
 * Org checkout: like the personal schema, the exam is MANDATORY — an org
 * buys one public exam per checkout; all-access grants are admin-only.
 */
export const createOrgPaypalOrderSchema = z.object({
  planId: uuid(),
  orgId: uuid(),
  examId: uuid(),
});

/**
 * An assignment prescribes a full test config (same bounds as
 * createTestSchema) plus a title, a due date and an audience.
 */
export const orgAssignmentSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(2, "Give the assignment a title")
      .max(140, "Keep the title under 140 characters"),
    description: z.string().trim().max(2000, "Too long").default(""),
    examId: uuid(),
    subjectIds: z.array(uuid()).min(1, "Choose at least one subject"),
    difficulty: z.enum([...DIFFICULTIES, "mixed"]).default("mixed"),
    numQuestions: z.coerce.number().int().min(5).max(100),
    mode: assignmentModeSchema.default("exam"),
    // Required for exam mode, absent for tutor (untimed). NOTE z.coerce turns
    // "" into 0 — the action must map "" → undefined BEFORE parsing, per the
    // trialsLimitSchema convention above.
    durationMin: z.coerce.number().int().min(5).max(240).optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a due date"),
    audience: z.enum(["all", "selected", "department"]),
    targetIds: z.array(uuid()).default([]),
    // Required exactly when audience='department' — that rule lives in the
    // action, like the selected-requires-targets check.
    departmentId: uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "exam" && v.durationMin === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["durationMin"],
        message: "Pick a time limit",
      });
    }
  });

/**
 * The invite textarea: addresses separated by whitespace, commas or
 * semicolons (people paste straight from Outlook). Dedupes case-insensitively
 * — the column is citext, so "Jane@x" and "jane@x" are the same invite.
 */
export function parseInviteEmails(raw: string): {
  emails: string[];
  invalid: string[];
} {
  const seen = new Set<string>();
  const emails: string[] = [];
  const invalid: string[] = [];

  for (const token of raw.split(/[\s,;]+/)) {
    if (token === "") continue;
    const parsed = emailSchema.safeParse(token);
    if (!parsed.success) {
      invalid.push(token);
      continue;
    }
    if (seen.has(parsed.data)) continue;
    seen.add(parsed.data);
    emails.push(parsed.data);
  }

  return { emails, invalid };
}

/* ── Courses ────────────────────────────────────────────────────── */

export const COURSE_LESSON_KINDS = [
  "video",
  "image",
  "text",
  "pdf",
  "quiz",
] as const;

export const courseMetaSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Give the course a title")
    .max(140, "Keep the title under 140 characters"),
  description: z.string().trim().max(2000, "Keep the description under 2000 characters"),
});

export const courseModuleTitleSchema = z
  .string()
  .trim()
  .min(2, "Give the module a title")
  .max(140, "Keep the title under 140 characters");

/**
 * One lesson save. passPct arrives only for quiz lessons; filePath only for
 * file-backed kinds — the action pairs this with the kind checks that the
 * course_lessons CHECK constraints restate in SQL.
 */
export const courseLessonSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Give the lesson a title")
    .max(140, "Keep the title under 140 characters"),
  kind: z.enum(COURSE_LESSON_KINDS),
  bodyMd: z.string().max(40_000, "Lesson text is capped at 40,000 characters"),
  /** Actions map "" → null BEFORE parsing (z.coerce turns "" into 0). */
  passPct: z.coerce
    .number()
    .int("Whole percentages only")
    .min(1, "At least 1%")
    .max(100, "At most 100%")
    .nullable(),
  filePath: z.string().trim().min(1).max(3000).nullable(),
  fileSize: z.coerce.number().int().min(0).max(1_000_000_000).nullable(),
});

export const courseQuestionSchema = z
  .object({
    promptMd: z
      .string()
      .trim()
      .min(3, "Write the question")
      .max(4000, "Keep the question under 4000 characters"),
    explanationMd: z
      .string()
      .trim()
      .max(4000, "Keep the explanation under 4000 characters"),
    options: z
      .array(
        z.object({
          /** Absent on newly added rows; present when editing existing. */
          id: uuid().optional(),
          label: z.string().trim().min(1, "Every option needs text").max(500),
          isCorrect: z.boolean(),
        })
      )
      .min(2, "Add at least two options")
      .max(8, "Eight options is the maximum"),
  })
  .superRefine((v, ctx) => {
    // Single-best-answer v1 — mirrors the exam bank's mcq_single rule.
    if (v.options.filter((o) => o.isCorrect).length !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "Choose exactly one correct option",
      });
    }
    const seen = new Set<string>();
    v.options.forEach((o, i) => {
      const key = o.label.trim().toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["options", i, "label"],
          message: "Duplicate option text",
        });
      }
      seen.add(key);
    });
  });

/** A quiz submission: at most one pick per question; grading treats missing
 * questions as wrong, so partial submissions are legal input. */
export const courseQuizSubmitSchema = z.object({
  lessonId: uuid(),
  answers: z
    .array(z.object({ questionId: uuid(), optionId: uuid() }))
    .max(200),
});

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, "Enter your full name")
  .max(120, "That name is too long");

/**
 * The name printed on CME certificates. Separate from fullNameSchema because
 * it is a different thing: full_name feeds greetings (lib/names.ts strips the
 * honorific for "Hi, Jane"), while this is the professional name a learner
 * wants on a credential — honorifics and post-nominals included. Capped at 80
 * to match the column CHECK; the certificate shrinks type to fit, but a name
 * longer than this cannot be set at all.
 */
export const credentialNameSchema = z
  .string()
  .trim()
  .min(2, "Enter the name for your certificate")
  .max(80, "That name is too long for a certificate");

/**
 * An org's exam sitting date (<input type="date"> value). Bounded to three
 * years out — a typo'd year would otherwise frame readiness against a
 * sitting a decade away.
 */
export const sittingDateSchema = z.iso
  .date("Pick a valid date")
  .refine((d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    const max = Date.now() + 3 * 365 * 86_400_000;
    return t >= Date.parse("2020-01-01") && t <= max;
  }, "That date looks wrong — sittings can be at most 3 years out");

/** null = clear the sitting date. Actions map "" → null BEFORE parsing. */
export const orgExamDateSchema = z.object({
  examId: uuid(),
  sittingOn: sittingDateSchema.nullable(),
});

/* ── Study plans ────────────────────────────────────────────────── */

export const PLAN_INTENSITIES = ["light", "standard", "intense"] as const;
export const planIntensitySchema = z.enum(PLAN_INTENSITIES);

/** Personal sitting date — same bounds as the org's (sittingDateSchema);
 * null = clear it and fall back to the org date. Actions map "" → null. */
export const planSittingSchema = z.object({
  examId: uuid(),
  sittingOn: sittingDateSchema.nullable(),
});

export const planIntensityUpdateSchema = z.object({
  examId: uuid(),
  intensity: planIntensitySchema,
});

/** POST /api/tests plan-goal launch: the server supplies the whole config
 * from the frozen week row, like an assignment launch — the client sends
 * only these ids. Goal ids are deterministic short strings ("mock",
 * "focus:<subjectId>"), not uuids. */
export const startPlanGoalSchema = z.object({
  planWeekId: uuid(),
  goalId: z.string().min(1).max(80),
});

/**
 * study_plan_weeks.goals — the versioned frozen-goals doc. The ONE parser
 * for that jsonb everywhere (lib/plan.ts, the launch route): a week whose
 * doc fails this parse renders as a generic history entry and is excluded
 * from adherence entirely, never a crash and never a fake 0%.
 */
export const planGoalSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1).max(80),
    type: z.literal("total_questions"),
    target: z.number().int().min(1),
  }),
  z.object({
    id: z.string().min(1).max(80),
    type: z.literal("focus_sessions"),
    subjectId: uuid(),
    /** Snapshotted so history renders correctly after subject renames. */
    subjectName: z.string().min(1).max(80),
    reason: z.enum(["coverage_gap", "weak_subject"]),
    sessions: z.number().int().min(1).max(10),
    questionsPerSession: z.number().int().min(5).max(100),
  }),
  z.object({
    id: z.string().min(1).max(80),
    type: z.literal("mock"),
    diagnostic: z.boolean(),
    numQuestions: z.number().int().min(5).max(100),
    durationMin: z.number().int().min(5).max(240),
  }),
]);

export const planGoalsDocSchema = z.object({
  v: z.literal(1),
  goals: z.array(planGoalSchema).min(1).max(12),
});

export type PlanGoal = z.infer<typeof planGoalSchema>;
export type PlanGoalsDoc = z.infer<typeof planGoalsDocSchema>;

/* ── Admin analytics dashboard ──────────────────────────────────── */

/** Preset range tabs — must stay in sync with RANGE_PRESETS in
 * lib/analytics-core.ts (imported here would drag core types into every
 * validation consumer, so the tuple is restated and pinned by a test). */
export const ANALYTICS_RANGES = ["7d", "30d", "90d", "12mo", "all"] as const;
export const analyticsRangeSchema = z.enum(ANALYTICS_RANGES);

/** Manual rollup trigger body (app/api/admin/analytics/rollup). */
export const adminRollupSchema = z.object({
  mode: z.enum(["nightly", "backfill"]).default("nightly"),
});

/** A rollup civil day (YYYY-MM-DD) from a query param. */
export const analyticsDaySchema = z.iso.date();
