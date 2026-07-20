import { z } from "zod";

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;

// Use z.guid(), not z.uuid(). Zod's z.uuid() enforces the RFC 9562 version
// and variant bits, but Postgres's `uuid` type accepts any 8-4-4-4-12 hex
// value — so strict validation would reject IDs the database happily stores
// (fixed-value seed ids, UUIDv7, etc). Match the database's definition.
export const uuid = () => z.guid();

export const createTestSchema = z.object({
  subjectIds: z.array(uuid()).min(1, "Choose at least one subject"),
  topicIds: z.array(uuid()).default([]),
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
    topicId: uuid(),
    type: z.enum(QUESTION_TYPES),
    difficulty: z.enum(DIFFICULTIES),
    stem: z.string().trim().min(10, "Write the question stem").max(5000),
    explanation: z.string().trim().min(10, "Explain the answer").max(5000),
    imagePath: z.string().trim().min(1).max(300).nullable().default(null),
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

export const subjectSchema = z.object({
  name: z.string().trim().min(2, "Subject name is too short").max(80),
});

export const topicSchema = z.object({
  subjectId: uuid(),
  name: z.string().trim().min(2, "Topic name is too short").max(80),
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
    topicId: String(fd.get("topicId") ?? ""),
    type: String(fd.get("type") ?? ""),
    difficulty: String(fd.get("difficulty") ?? ""),
    stem: String(fd.get("stem") ?? ""),
    explanation: String(fd.get("explanation") ?? ""),
    imagePath: imagePath.length > 0 ? imagePath : null,
    isPublished: fd.get("isPublished") === "on" || fd.get("isPublished") === "true",
    options,
  };
}

/* ── Account / auth ─────────────────────────────────────────────── */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters");

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, "Enter your full name")
  .max(120, "That name is too long");
