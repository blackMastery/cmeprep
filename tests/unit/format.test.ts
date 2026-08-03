import { describe, expect, it } from "vitest";
import {
  ACCURACY_PASS,
  ACCURACY_WEAK,
  accuracyTone,
  formatDuration,
  priceLabel,
} from "@/lib/format";

describe("accuracyTone", () => {
  it("paints a passing score green", () => {
    expect(accuracyTone(100)).toBe("bg-teal");
    expect(accuracyTone(80)).toBe("bg-teal");
  });

  it("paints a weak score amber", () => {
    expect(accuracyTone(60)).toBe("bg-sun");
  });

  it("paints a failing score red", () => {
    expect(accuracyTone(0)).toBe("bg-destructive");
    expect(accuracyTone(32)).toBe("bg-destructive");
  });

  // The boundaries are the whole point of the helper — a subject sitting
  // exactly on a threshold must not flip tone between two renders.
  it("treats each threshold as inclusive", () => {
    expect(accuracyTone(ACCURACY_WEAK - 1)).toBe("bg-destructive");
    expect(accuracyTone(ACCURACY_WEAK)).toBe("bg-sun");
    expect(accuracyTone(ACCURACY_PASS - 1)).toBe("bg-sun");
    expect(accuracyTone(ACCURACY_PASS)).toBe("bg-teal");
  });

  it("handles fractional percentages", () => {
    expect(accuracyTone(49.9)).toBe("bg-destructive");
    expect(accuracyTone(74.9)).toBe("bg-sun");
    expect(accuracyTone(75.1)).toBe("bg-teal");
  });
});

describe("priceLabel", () => {
  it("drops the decimals on whole dollars", () => {
    expect(priceLabel(14400)).toBe("$144");
    expect(priceLabel(0)).toBe("$0");
  });

  it("keeps cents when they are non-zero", () => {
    expect(priceLabel(1950)).toBe("$19.50");
  });
});

describe("formatDuration", () => {
  it("formats under an hour as M:SS", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(65)).toBe("01:05");
  });

  it("adds an hours segment past an hour", () => {
    expect(formatDuration(3661)).toBe("1:01:01");
  });

  it("floors negatives to zero rather than emitting a minus", () => {
    expect(formatDuration(-5)).toBe("00:00");
  });
});
