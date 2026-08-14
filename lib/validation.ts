import { z } from "zod";

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;

// Use z.guid(), not z.uuid(). Zod's z.uuid() enforces the RFC 9562 version
// and variant bits, but Postgres's `uuid` type accepts any 8-4-4-4-12 hex
// value — so strict validation would reject IDs the database happily stores
// (fixed-value seed ids, UUIDv7, etc). Match the database's definition.
export const uuid = () => z.guid();

export const createTestSchema = z.object({
  examId: uuid(),
  subjectIds: z.array(uuid()).min(1, "Choose at least one subject"),
  difficulty: z.enum([...DIFFICULTIES, "mixed"]).default("mixed"),
  numQuestions: z.number().int().min(5).max(100),
  durationMin: z.number().int().min(5).max(240),
});

export type CreateTestInput = z.infer<typeof createTestSchema>;

export const saveAnswerSchema = z.object({
  questionId: uuid(),
  selectedOptionIds: z.array(uuid()).max(10),
  flagged: z.boolean().optional(),
  timeSpentSec: z.number().int().min(0).max(86_400).optional(),
});

/** Batch shape used by the beacon on page unload. */
export const saveAnswersSchema = z.object({
  answers: z.array(saveAnswerSchema).min(1).max(100),
});

// ── Admin content schemas ───────────────────────────────────

export const QUESTION_TYPES = [
  "mcq_single",
  "mcq_multi",
  "image_based",
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
    options: z
      .array(questionOptionSchema)
      .min(2, "Add at least two options")
      .max(8, "Eight options is the maximum"),
  })
  .superRefine((v, ctx) => {
    const correct = v.options.filter((o) => o.isCorrect).length;

    // `image_based` is a single-answer question that happens to carry an
    // image — the renderer keys "multi" off `type === "mcq_multi"` only.
    if (v.type === "mcq_multi") {
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
export const orgAssignmentSchema = z.object({
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
  durationMin: z.coerce.number().int().min(5).max(240),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a due date"),
  audience: z.enum(["all", "selected"]),
  targetIds: z.array(uuid()).default([]),
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

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, "Enter your full name")
  .max(120, "That name is too long");
