import { describe, expect, it } from "vitest";
import {
  compareUserSortRows,
  sortUserSortRows,
  type UserSortRow,
} from "@/lib/admin/users-core";

const base = (over: Partial<UserSortRow> = {}): UserSortRow => ({
  id: "1",
  name: "Alice",
  email: "alice@example.com",
  role: "student",
  planEnd: "2026-10-09T00:00:00Z",
  questions: 10,
  tests: 2,
  joined: "2026-09-01T00:00:00Z",
  ...over,
});

describe("compareUserSortRows", () => {
  it("orders names with empty values last", () => {
    const a = base({ name: null });
    const b = base({ name: "Bob" });
    expect(compareUserSortRows(a, b, "name")).toBeGreaterThan(0);
  });

  it("orders plan by period end with nulls last", () => {
    const a = base({ planEnd: null });
    const b = base({ planEnd: "2026-01-01T00:00:00Z" });
    expect(compareUserSortRows(a, b, "plan")).toBeGreaterThan(0);
  });

  it("orders questions numerically", () => {
    const a = base({ questions: 5 });
    const b = base({ questions: 120 });
    expect(compareUserSortRows(a, b, "questions")).toBeLessThan(0);
  });
});

describe("sortUserSortRows", () => {
  it("keeps null names trailing when descending", () => {
    const rows = [
      base({ id: "a", name: null }),
      base({ id: "b", name: "Zara" }),
      base({ id: "c", name: "Mia" }),
    ];
    const sorted = sortUserSortRows(rows, "name", false);
    expect(sorted.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
});
