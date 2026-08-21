import type { Difficulty, QuestionType } from "@/lib/supabase/types";
import { DIFFICULTIES, QUESTION_TYPES } from "@/lib/validation";

/**
 * The filter set the question list AND the export share. Parsed from the
 * same query string in one place so what the admin sees on screen is exactly
 * what lands in the file — a second parser would drift the first time a
 * filter was added to one side only.
 */
export type QuestionListFilters = {
  search?: string;
  examId?: string;
  specialtyId?: string;
  subjectId?: string;
  difficulty?: Difficulty;
  type?: QuestionType;
  published?: boolean;
  includeDeleted?: boolean;
  page?: number;
  /** Narrow to one org's private bank; omitted = everything (platform). */
  orgId?: string;
};

export type SearchParamsLike = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : undefined;
}

export function questionFiltersFromSearchParams(
  sp: SearchParamsLike
): QuestionListFilters {
  const difficulty = one(sp.difficulty);
  const type = one(sp.type);
  const published = one(sp.published);
  return {
    search: one(sp.q),
    examId: one(sp.exam),
    specialtyId: one(sp.specialty),
    subjectId: one(sp.subject),
    difficulty: DIFFICULTIES.includes(difficulty as Difficulty)
      ? (difficulty as Difficulty)
      : undefined,
    type: QUESTION_TYPES.includes(type as QuestionType)
      ? (type as QuestionType)
      : undefined,
    published:
      published === "true" ? true : published === "false" ? false : undefined,
    includeDeleted: one(sp.includeDeleted) === "1",
    page: Number(one(sp.page) ?? 1) || 1,
  };
}

/** Query string carrying every list filter except the page — the export link. */
export function questionFiltersQueryString(sp: SearchParamsLike): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "page") continue;
    const value = one(v);
    if (value) qs.set(k, value);
  }
  return qs.toString();
}
