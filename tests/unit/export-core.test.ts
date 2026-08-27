import { describe, expect, it } from "vitest";
import {
  EXPORT_COLUMNS,
  exportFilename,
  exportTypeValue,
  sortForExport,
  toExportRow,
  type ExportableQuestion,
} from "@/lib/admin/export-core";
import { COLUMNS, OPTION_LETTERS } from "@/lib/admin/import-core";
import {
  questionFiltersFromSearchParams,
  questionFiltersQueryString,
} from "@/lib/admin/question-filters-core";

const imageUrl = (p: string | null) => (p ? `https://cdn.test/${p}` : null);

function q(over: Partial<ExportableQuestion> = {}): ExportableQuestion {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    type: "mcq_single",
    difficulty: "medium",
    stem: "A stem",
    explanation: "An explanation",
    image_path: null,
    created_at: "2026-01-01T00:00:00Z",
    examName: "MRCP",
    specialtyName: "Medicine",
    subjectName: "Cardiology",
    options: [
      { label: "Alpha", is_correct: false, position: 0 },
      { label: "Beta", is_correct: true, position: 1 },
    ],
    modelAnswer: null,
    ...over,
  };
}

describe("toExportRow", () => {
  it("maps taxonomy, correct letters and the id", () => {
    const row = toExportRow(q(), imageUrl);
    expect(row.exam).toBe("MRCP");
    expect(row.specialty).toBe("Medicine");
    expect(row.subject).toBe("Cardiology");
    expect(row.type).toBe("single");
    expect(row.difficulty).toBe("medium");
    expect(row.optionA).toBe("Alpha");
    expect(row.optionB).toBe("Beta");
    expect(row.optionC).toBe("");
    expect(row.correct).toBe("B");
    expect(row.modelAnswer).toBe("");
    expect(row.image).toBe("");
    expect(row.questionId).toBe(q().id);
    expect(row.exportNotes).toBe("");
  });

  it("orders options by position, not array order", () => {
    const row = toExportRow(
      q({
        options: [
          { label: "Second", is_correct: true, position: 1 },
          { label: "First", is_correct: false, position: 0 },
        ],
      }),
      imageUrl
    );
    expect(row.optionA).toBe("First");
    expect(row.correct).toBe("B");
  });

  it("joins multiple correct letters for multi questions", () => {
    const row = toExportRow(
      q({
        type: "mcq_multi",
        options: [
          { label: "a", is_correct: true, position: 0 },
          { label: "b", is_correct: false, position: 1 },
          { label: "c", is_correct: true, position: 2 },
        ],
      }),
      imageUrl
    );
    expect(row.type).toBe("multi");
    expect(row.correct).toBe("A,C");
  });

  it("truncates beyond H and says so, flagging dropped correct options", () => {
    const options = Array.from({ length: 10 }, (_, i) => ({
      label: `opt${i}`,
      is_correct: i === 9,
      position: i,
    }));
    const row = toExportRow(q({ type: "mcq_single", options }), imageUrl);
    expect(row.optionH).toBe("opt7");
    expect(row).not.toHaveProperty("optionI");
    expect(row.correct).toBe("");
    expect(row.exportNotes).toContain("10 options; 2 beyond H dropped.");
    expect(row.exportNotes).toContain("1 dropped option(s) were marked correct.");
  });

  it("exports OSCE with the model answer and an empty Correct", () => {
    const row = toExportRow(
      q({ type: "osce", options: [], modelAnswer: "Naloxone." }),
      imageUrl
    );
    expect(row.type).toBe("osce");
    expect(row.modelAnswer).toBe("Naloxone.");
    expect(row.correct).toBe("");
    expect(row.optionA).toBe("");
    expect(row.exportNotes).toBe("");
  });

  it("notes an OSCE question missing its model answer", () => {
    const row = toExportRow(q({ type: "osce", options: [] }), imageUrl);
    expect(row.exportNotes).toContain("no model answer");
  });

  it("never leaks a model answer onto an MCQ row", () => {
    const row = toExportRow(q({ modelAnswer: "stale" }), imageUrl);
    expect(row.modelAnswer).toBe("");
  });

  it("exports image_based as single/multi with the image URL", () => {
    const single = toExportRow(
      q({ type: "image_based", image_path: "q/1.png" }),
      imageUrl
    );
    expect(single.type).toBe("single");
    expect(single.image).toBe("https://cdn.test/q/1.png");
    const multi = toExportRow(
      q({
        type: "image_based",
        image_path: "q/2.png",
        options: [
          { label: "a", is_correct: true, position: 0 },
          { label: "b", is_correct: true, position: 1 },
        ],
      }),
      imageUrl
    );
    expect(multi.type).toBe("multi");
  });

  it("fills every export column key", () => {
    const row = toExportRow(q(), imageUrl);
    for (const c of EXPORT_COLUMNS) expect(row).toHaveProperty(c.key);
    for (const l of OPTION_LETTERS) expect(row).toHaveProperty(`option${l}`);
  });
});

describe("exportTypeValue", () => {
  it("maps DB types to template values", () => {
    expect(exportTypeValue("mcq_single", 1)).toBe("single");
    expect(exportTypeValue("mcq_multi", 1)).toBe("multi");
    expect(exportTypeValue("osce", 0)).toBe("osce");
    expect(exportTypeValue("image_based", 1)).toBe("single");
    expect(exportTypeValue("image_based", 2)).toBe("multi");
  });
});

describe("EXPORT_COLUMNS", () => {
  it("starts with every import column (Exam included) so the sheet re-imports", () => {
    expect(EXPORT_COLUMNS.slice(0, COLUMNS.length)).toEqual(COLUMNS);
    expect(EXPORT_COLUMNS[0].key).toBe("exam");
  });
});

describe("sortForExport", () => {
  it("orders exam → specialty → subject → created_at → id", () => {
    const rows = [
      q({ id: "b", examName: "MRCP", subjectName: "Renal", created_at: "2026-01-02" }),
      q({ id: "a", examName: "mrcp", subjectName: "Renal", created_at: "2026-01-01" }),
      q({ id: "c", examName: "AMC", subjectName: "Z" }),
      q({ id: "d", examName: "MRCP", subjectName: "Cardiology" }),
    ];
    expect(sortForExport(rows).map((r) => r.id)).toEqual(["c", "d", "a", "b"]);
    expect(rows[0].id).toBe("b"); // input untouched
  });
});

describe("exportFilename", () => {
  const date = new Date("2026-08-21T10:00:00Z");
  it("slugs the exam name", () => {
    expect(exportFilename("MRCP Part 1 (UK)", date)).toBe(
      "questions-export-mrcp-part-1-uk-2026-08-21.xlsx"
    );
  });
  it("falls back to all-exams", () => {
    expect(exportFilename(null, date)).toBe("questions-export-all-exams-2026-08-21.xlsx");
    expect(exportFilename("!!!", date)).toBe("questions-export-all-exams-2026-08-21.xlsx");
  });
});

describe("question filters", () => {
  it("parses the list query string and drops unknown enum values", () => {
    const f = questionFiltersFromSearchParams({
      q: "chest pain",
      exam: "e1",
      difficulty: "hard",
      type: "bogus",
      published: "false",
      includeDeleted: "1",
      page: ["3"],
    });
    expect(f).toEqual({
      search: "chest pain",
      examId: "e1",
      specialtyId: undefined,
      subjectId: undefined,
      difficulty: "hard",
      type: undefined,
      published: false,
      includeDeleted: true,
      page: 3,
      pageSize: 20,
    });
  });

  it("only serves the listed page sizes", () => {
    expect(questionFiltersFromSearchParams({ perPage: "50" }).pageSize).toBe(50);
    expect(questionFiltersFromSearchParams({ perPage: ["100"] }).pageSize).toBe(100);
    // Off-list values fall back rather than clamp — a hand-edited link must
    // never pull thousands of rows in one request.
    expect(questionFiltersFromSearchParams({ perPage: "5000" }).pageSize).toBe(20);
    expect(questionFiltersFromSearchParams({ perPage: "0" }).pageSize).toBe(20);
    expect(questionFiltersFromSearchParams({ perPage: "abc" }).pageSize).toBe(20);
    expect(questionFiltersFromSearchParams({}).pageSize).toBe(20);
  });

  it("builds the export link without the paging keys", () => {
    expect(
      questionFiltersQueryString({
        page: "4",
        perPage: "100",
        exam: "e1",
        q: "",
        type: ["osce"],
      })
    ).toBe("exam=e1&type=osce");
  });
});
