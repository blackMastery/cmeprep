import { describe, expect, it } from "vitest";
import {
  correctnessChanged,
  diffOptions,
  OptionOwnershipError,
  type ExistingOption,
} from "@/lib/admin/option-diff";

const Q = "11111111-1111-1111-1111-111111111111";

function existing(
  overrides: Partial<ExistingOption>[] = []
): ExistingOption[] {
  const base: ExistingOption[] = [
    { id: "opt-a", label: "A", is_correct: true, position: 0, deleted_at: null },
    { id: "opt-b", label: "B", is_correct: false, position: 1, deleted_at: null },
  ];
  return base.map((b, i) => ({ ...b, ...(overrides[i] ?? {}) }));
}

// Deterministic id generator so assertions are stable.
function ids() {
  let n = 0;
  return () => `new-${++n}`;
}

describe("diffOptions", () => {
  it("updates existing rows in place, preserving ids", () => {
    const { rows, retireIds } = diffOptions(
      Q,
      existing(),
      [
        { id: "opt-a", label: "A edited", isCorrect: true },
        { id: "opt-b", label: "B", isCorrect: false },
      ],
      ids()
    );

    expect(rows.map((r) => r.id)).toEqual(["opt-a", "opt-b"]);
    expect(rows[0].label).toBe("A edited");
    expect(retireIds).toEqual([]);
  });

  it("assigns ids to newly added rows", () => {
    const { rows } = diffOptions(
      Q,
      existing(),
      [
        { id: "opt-a", label: "A", isCorrect: true },
        { id: "opt-b", label: "B", isCorrect: false },
        { label: "C", isCorrect: false },
      ],
      ids()
    );

    expect(rows).toHaveLength(3);
    expect(rows[2].id).toBe("new-1");
    expect(rows[2].question_id).toBe(Q);
  });

  it("retires removed options instead of deleting them", () => {
    const { rows, retireIds } = diffOptions(
      Q,
      existing(),
      [{ id: "opt-a", label: "A", isCorrect: true }],
      ids()
    );

    expect(rows).toHaveLength(1);
    expect(retireIds).toEqual(["opt-b"]);
  });

  it("does not re-retire an already-retired option", () => {
    const withRetired = [
      ...existing(),
      {
        id: "opt-old",
        label: "Old",
        is_correct: false,
        position: 2,
        deleted_at: "2026-01-01T00:00:00Z",
      },
    ];

    const { retireIds } = diffOptions(
      Q,
      withRetired,
      [
        { id: "opt-a", label: "A", isCorrect: true },
        { id: "opt-b", label: "B", isCorrect: false },
      ],
      ids()
    );

    expect(retireIds).toEqual([]);
  });

  it("revives a retired option that is re-added, keeping its id", () => {
    const withRetired: ExistingOption[] = [
      ...existing(),
      {
        id: "opt-old",
        label: "Old",
        is_correct: false,
        position: 2,
        deleted_at: "2026-01-01T00:00:00Z",
      },
    ];

    const { rows } = diffOptions(
      Q,
      withRetired,
      [
        { id: "opt-a", label: "A", isCorrect: true },
        { id: "opt-old", label: "Old", isCorrect: false },
      ],
      ids()
    );

    const revived = rows.find((r) => r.id === "opt-old");
    expect(revived?.deleted_at).toBeNull();
  });

  it("renumbers positions on reorder", () => {
    const { rows } = diffOptions(
      Q,
      existing(),
      [
        { id: "opt-b", label: "B", isCorrect: false },
        { id: "opt-a", label: "A", isCorrect: true },
      ],
      ids()
    );

    expect(rows.map((r) => [r.id, r.position])).toEqual([
      ["opt-b", 0],
      ["opt-a", 1],
    ]);
  });

  it("trims option labels", () => {
    const { rows } = diffOptions(
      Q,
      existing(),
      [
        { id: "opt-a", label: "  padded  ", isCorrect: true },
        { id: "opt-b", label: "B", isCorrect: false },
      ],
      ids()
    );
    expect(rows[0].label).toBe("padded");
  });

  it("rejects an option id belonging to another question", () => {
    expect(() =>
      diffOptions(
        Q,
        existing(),
        [
          { id: "someone-elses-option", label: "Injected", isCorrect: true },
          { id: "opt-b", label: "B", isCorrect: false },
        ],
        ids()
      )
    ).toThrow(OptionOwnershipError);
  });

  it("handles a question that had no options yet", () => {
    const { rows, retireIds } = diffOptions(
      Q,
      [],
      [
        { label: "A", isCorrect: true },
        { label: "B", isCorrect: false },
      ],
      ids()
    );
    expect(rows.map((r) => r.id)).toEqual(["new-1", "new-2"]);
    expect(retireIds).toEqual([]);
  });
});

describe("correctnessChanged", () => {
  it("is false when the key is untouched", () => {
    const { rows } = diffOptions(
      Q,
      existing(),
      [
        { id: "opt-a", label: "A", isCorrect: true },
        { id: "opt-b", label: "B", isCorrect: false },
      ],
      ids()
    );
    expect(correctnessChanged(existing(), rows)).toBe(false);
  });

  it("is true when the correct option moves", () => {
    const { rows } = diffOptions(
      Q,
      existing(),
      [
        { id: "opt-a", label: "A", isCorrect: false },
        { id: "opt-b", label: "B", isCorrect: true },
      ],
      ids()
    );
    expect(correctnessChanged(existing(), rows)).toBe(true);
  });

  it("is true when an extra correct option is added", () => {
    const { rows } = diffOptions(
      Q,
      existing(),
      [
        { id: "opt-a", label: "A", isCorrect: true },
        { id: "opt-b", label: "B", isCorrect: true },
      ],
      ids()
    );
    expect(correctnessChanged(existing(), rows)).toBe(true);
  });

  it("ignores label-only edits", () => {
    const { rows } = diffOptions(
      Q,
      existing(),
      [
        { id: "opt-a", label: "Totally different wording", isCorrect: true },
        { id: "opt-b", label: "B", isCorrect: false },
      ],
      ids()
    );
    expect(correctnessChanged(existing(), rows)).toBe(false);
  });
});
