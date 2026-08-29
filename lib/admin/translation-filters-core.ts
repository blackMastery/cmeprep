import {
  one,
  parsePage,
  parsePageSize,
  type SearchParamsLike,
} from "@/lib/admin/question-filters-core";
import { isLanguageCode } from "@/lib/translation-core";

/**
 * The filter set for /admin/translations, parsed from the query string in
 * one place (the question list's precedent) so the filter form, the list
 * and the pager links can't drift.
 */
export type TranslationListFilters = {
  language?: string;
  /** Only rows whose source has changed since they were translated. */
  stale?: boolean;
  /** A question id (exact) or a stem fragment. */
  search?: string;
  /** ISO dates, inclusive, on updated_at. */
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
};

/**
 * The stale filter can't be expressed in SQL (staleness is a hash of live
 * text against the row), so it scans the most recent rows and pages in
 * memory. The cap keeps that scan bounded; the page says when it hit it.
 */
export const STALE_SCAN_LIMIT = 500;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value: string | undefined): string | undefined {
  return value && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))
    ? value
    : undefined;
}

export function translationFiltersFromSearchParams(
  sp: SearchParamsLike
): TranslationListFilters {
  const language = one(sp.lang);
  const search = one(sp.q)?.trim();
  return {
    // A stale link can't smuggle an unknown code into the query.
    language: language && isLanguageCode(language) ? language : undefined,
    stale: one(sp.stale) === "1",
    search: search && search.length > 0 ? search.slice(0, 200) : undefined,
    from: isoDate(one(sp.from)),
    to: isoDate(one(sp.to)),
    page: parsePage(one(sp.page)),
    pageSize: parsePageSize(one(sp.perPage)),
  };
}
