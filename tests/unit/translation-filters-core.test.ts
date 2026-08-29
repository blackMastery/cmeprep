import { describe, expect, it } from "vitest";
import {
  STALE_SCAN_LIMIT,
  translationFiltersFromSearchParams,
} from "@/lib/admin/translation-filters-core";
import { DEFAULT_PAGE_SIZE } from "@/lib/admin/question-filters-core";

describe("translationFiltersFromSearchParams", () => {
  it("defaults to page 1 of the default size with nothing set", () => {
    expect(translationFiltersFromSearchParams({})).toEqual({
      language: undefined,
      stale: false,
      search: undefined,
      from: undefined,
      to: undefined,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it("drops an unknown language code and a malformed date", () => {
    const f = translationFiltersFromSearchParams({
      lang: "klingon",
      from: "2026-13-45",
      to: "not-a-date",
    });
    expect(f.language).toBeUndefined();
    expect(f.from).toBeUndefined();
    expect(f.to).toBeUndefined();
  });

  it("keeps valid filters, trims the search and reads the stale flag", () => {
    const f = translationFiltersFromSearchParams({
      lang: "es",
      q: "  chest pain ",
      from: "2026-08-01",
      to: "2026-08-31",
      stale: "1",
      page: "3",
      perPage: "50",
    });
    expect(f).toEqual({
      language: "es",
      stale: true,
      search: "chest pain",
      from: "2026-08-01",
      to: "2026-08-31",
      page: 3,
      pageSize: 50,
    });
  });

  it("takes the first value of a repeated key and normalises page to an integer ≥ 1", () => {
    const f = translationFiltersFromSearchParams({ lang: ["fr", "es"], page: "-2" });
    expect(f.language).toBe("fr");
    expect(f.page).toBe(1);
    expect(translationFiltersFromSearchParams({ page: "1.5" }).page).toBe(1);
    expect(translationFiltersFromSearchParams({ page: "Infinity" }).page).toBe(1);
    expect(translationFiltersFromSearchParams({ page: "3" }).page).toBe(3);
  });

  it("bounds the stale scan", () => {
    expect(STALE_SCAN_LIMIT).toBe(500);
  });
});
