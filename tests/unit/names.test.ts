import { describe, expect, it } from "vitest";
import { firstName } from "@/lib/names";

describe("firstName", () => {
  it("skips a leading honorific", () => {
    expect(firstName("Dr. Anita Persaud")).toBe("Anita");
  });

  it("handles an honorific without a period", () => {
    expect(firstName("Dr Anita Persaud")).toBe("Anita");
  });

  it("returns the first name when there is no honorific", () => {
    expect(firstName("Anita Persaud")).toBe("Anita");
  });

  it("handles a single name", () => {
    expect(firstName("Anita")).toBe("Anita");
  });

  it("collapses extra whitespace", () => {
    expect(firstName("  Prof.   Rajesh  Singh ")).toBe("Rajesh");
  });

  it("returns null for null, empty, or honorific-only input", () => {
    expect(firstName(null)).toBeNull();
    expect(firstName("")).toBeNull();
    expect(firstName("   ")).toBeNull();
    expect(firstName("Dr.")).toBeNull();
  });
});
