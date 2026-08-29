import { describe, expect, it } from "vitest";
import {
  escapeLike,
  one,
  parsePage,
  questionFiltersFromSearchParams,
} from "@/lib/admin/question-filters-core";

describe("one", () => {
  it("takes the first value and treats empty as absent", () => {
    expect(one("a")).toBe("a");
    expect(one(["b", "c"])).toBe("b");
    expect(one("")).toBeUndefined();
    expect(one(undefined)).toBeUndefined();
  });
});

describe("parsePage", () => {
  // A fractional page becomes a fractional PostgREST offset, which PostgREST
  // rejects — and the list would render a false "nothing matches".
  it("always yields an integer ≥ 1", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-3")).toBe(1);
    expect(parsePage("2.7")).toBe(2);
    expect(parsePage("Infinity")).toBe(1);
    expect(parsePage("NaN")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("12")).toBe(12);
  });

  it("is what the question list uses", () => {
    expect(questionFiltersFromSearchParams({ page: "1.5" }).page).toBe(1);
  });
});

describe("escapeLike", () => {
  it("escapes ilike wildcards and the escape character itself", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("back\\slash")).toBe("back\\\\slash");
    expect(escapeLike("plain")).toBe("plain");
  });
});
