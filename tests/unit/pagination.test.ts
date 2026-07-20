import { describe, expect, it } from "vitest";
import { pageWindow } from "@/lib/pagination";

describe("pageWindow", () => {
  it("lists every page when there are seven or fewer", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("elides the middle from the first page", () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, "gap", 20]);
  });

  it("keeps current ±1 with gaps on both sides", () => {
    expect(pageWindow(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
  });

  it("never hides exactly one page behind an ellipsis", () => {
    // Between 1 and 3-1=2 there is no room; between 4+1=5 and 7... gap of 1
    // (page 6) must render as the number itself.
    expect(pageWindow(4, 8)).toEqual([1, 2, 3, 4, 5, "gap", 8]);
    expect(pageWindow(5, 8)).toEqual([1, "gap", 4, 5, 6, 7, 8]);
  });

  it("clamps sanely at the last page", () => {
    expect(pageWindow(20, 20)).toEqual([1, "gap", 19, 20]);
  });
});
