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
  /** Rows per page — always one of PAGE_SIZE_OPTIONS; omitted = default. */
  pageSize?: number;
  /** Narrow to one org's private bank; omitted = everything (platform). */
  orgId?: string;
};

/**
 * The only page sizes the list will serve. A free-form `perPage` would let a
 * stale or hand-edited link ask for thousands of rows (and their option and
 * usage lookups) in one request, so anything off this list falls back to the
 * default rather than being clamped.
 */
export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE: (typeof PAGE_SIZE_OPTIONS)[number] = 20;

export function parsePageSize(value: string | undefined): number {
  const n = Number(value);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n)
    ? n
    : DEFAULT_PAGE_SIZE;
}

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
    pageSize: parsePageSize(one(sp.perPage)),
  };
}

/**
 * Query string carrying every list filter except the paging keys — the export
 * link. Page size is a screen concern; the export always takes every match.
 */
export function questionFiltersQueryString(sp: SearchParamsLike): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "page" || k === "perPage") continue;
    const value = one(v);
    if (value) qs.set(k, value);
  }
  return qs.toString();
}
