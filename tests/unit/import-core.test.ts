import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  EXAMPLE_ROWS,
  IMPORT_ROW_CAP,
  PLACEHOLDER_SUBJECT_ID,
  coerceCellValue,
  normalizeStem,
  parseMatrix,
  type ImportAnalysis,
  type TaxonomySnapshot,
} from "@/lib/admin/import-core";

// ── Fixtures ────────────────────────────────────────────────

const HEADERS = COLUMNS.map((c) => c.header);
const COL = new Map(COLUMNS.map((c, i) => [c.key, i]));

/** Headers actually shipped in the generated template (Exam excluded). */
const TEMPLATE_HEADERS = COLUMNS.filter((c) => c.inTemplate !== false).map(
  (c) => c.header
);

/** Default forced exam — matches the default exam in TAXONOMY below. */
const FORCED = {
  id: "e0000000-0000-0000-0000-000000000001",
  name: "Medical Board Exam",
};

/** A second, non-default forced exam — matches the USMLE exam in TAXONOMY. */
const USMLE = {
  id: "e0000000-0000-0000-0000-000000000002",
  name: "USMLE",
};

// Default exam/specialty plus a SECOND exam containing a subject that shares
// its name with one in the default tree — exercising composite resolution.
const TAXONOMY: TaxonomySnapshot = {
  exams: [
    {
      id: "e0000000-0000-0000-0000-000000000001",
      name: "Medical Board Exam",
      specialties: [
        {
          id: "5c000000-0000-0000-0000-000000000001",
          name: "General",
          subjects: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              name: "Medicine",
            },
            {
              id: "22222222-2222-2222-2222-222222222222",
              name: "Surgery",
            },
          ],
        },
      ],
    },
    {
      id: "e0000000-0000-0000-0000-000000000002",
      name: "USMLE",
      specialties: [
        {
          id: "5c000000-0000-0000-0000-000000000002",
          name: "Internal Medicine",
          subjects: [
            {
              id: "99999999-9999-9999-9999-999999999999",
              name: "Medicine", // same name as the default tree's subject
            },
          ],
        },
      ],
    },
  ],
  defaultExamName: "Medical Board Exam",
  defaultSpecialtyName: "General",
};

/** Build a cells array aligned to the canonical header order. */
function cells(fields: Record<string, unknown>): unknown[] {
  const row: unknown[] = new Array(HEADERS.length).fill("");
  for (const [key, value] of Object.entries(fields)) {
    const index = COL.get(key);
    if (index === undefined) throw new Error(`unknown key ${key}`);
    row[index] = value;
  }
  return row;
}

function goodRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject: "Medicine",
    type: "single",
    difficulty: "easy",
    stem: "A 60-year-old presents with exertional chest pain relieved by rest. What is the most likely diagnosis?",
    explanation:
      "Exertional pain relieved by rest is the classic description of stable angina.",
    optionA: "Stable angina",
    optionB: "Pericarditis",
    correct: "A",
    ...overrides,
  };
}

function run(
  rows: Record<string, unknown>[],
  opts: {
    autoCreate?: boolean;
    header?: unknown[];
    startRow?: number;
    taxonomy?: TaxonomySnapshot;
    forcedExam?: { id: string; name: string };
  } = {}
): ImportAnalysis {
  const startRow = opts.startRow ?? 2;
  return parseMatrix(
    {
      header: opts.header ?? HEADERS,
      rows: rows.map((r, i) => ({ rowNumber: startRow + i, cells: cells(r) })),
    },
    opts.taxonomy ?? TAXONOMY,
    {
      autoCreateTaxonomy: opts.autoCreate ?? true,
      forcedExam: opts.forcedExam ?? FORCED,
    }
  );
}

// A sheet from BEFORE the Exam/Specialty columns existed.
const LEGACY_COLUMNS = COLUMNS.filter(
  (c) => c.key !== "exam" && c.key !== "specialty"
);
const LEGACY_HEADERS = LEGACY_COLUMNS.map((c) => c.header);

function runLegacy(
  rows: Record<string, unknown>[],
  forcedExam: { id: string; name: string } = FORCED
): ImportAnalysis {
  return parseMatrix(
    {
      header: LEGACY_HEADERS,
      rows: rows.map((r, i) => ({
        rowNumber: 2 + i,
        cells: LEGACY_COLUMNS.map((c) => r[c.key] ?? ""),
      })),
    },
    TAXONOMY,
    { autoCreateTaxonomy: true, forcedExam }
  );
}

const errorsOf = (a: ImportAnalysis, row: number) =>
  a.lines.filter((l) => l.row === row && l.severity === "error").map((l) => l.message);

// ── Header handling ─────────────────────────────────────────

describe("header handling", () => {
  it("matches headers case-insensitively with NBSP and extra whitespace", () => {
    const header = HEADERS.map((h) => `  ${h.toUpperCase()} `);
    const a = run([goodRow()], { header });
    expect(a.fileErrors).toEqual([]);
    expect(a.counts.valid).toBe(1);
  });

  it("reports every missing required column as a file error", () => {
    const header = ["Subject"]; // most required columns missing
    const a = run([], { header });
    expect(a.fileErrors.some((e) => e.includes('"Stem"'))).toBe(true);
    expect(a.fileErrors.some((e) => e.includes('"Correct"'))).toBe(true);
    expect(a.fileErrors.some((e) => e.includes('"Option A"'))).toBe(true);
    // Exam and Specialty columns are OPTIONAL — never demanded.
    expect(a.fileErrors.some((e) => e.includes('"Exam"'))).toBe(false);
    expect(a.fileErrors.some((e) => e.includes('"Specialty"'))).toBe(false);
  });

  it("rejects a duplicate known header", () => {
    const a = run([], { header: [...HEADERS, "stem"] });
    expect(a.fileErrors.some((e) => e.includes('"Stem"') && e.includes("more than once"))).toBe(true);
  });

  it("ignores unknown columns entirely", () => {
    const header = [...HEADERS, "Internal notes"];
    const a = parseMatrix(
      {
        header,
        rows: [
          { rowNumber: 2, cells: [...cells(goodRow()), "reviewer: KC"] },
          // content ONLY in the unknown column → blank row, skipped silently
          { rowNumber: 3, cells: [...cells({}), "stray note"] },
        ],
      },
      TAXONOMY,
      { autoCreateTaxonomy: true, forcedExam: FORCED }
    );
    expect(a.counts.valid).toBe(1);
    expect(a.counts.dataRows).toBe(1);
    expect(a.lines.filter((l) => l.row === 3)).toEqual([]);
  });

  it("errors on a header-only file gracefully", () => {
    const a = run([]);
    expect(a.fileErrors).toEqual([]);
    expect(a.counts.dataRows).toBe(0);
    expect(a.validRows).toEqual([]);
  });
});

// ── Cell coercion ───────────────────────────────────────────

describe("coerceCellValue", () => {
  it("passes strings through and stringifies numbers/booleans", () => {
    expect(coerceCellValue("text")).toEqual({ text: "text" });
    expect(coerceCellValue(0)).toEqual({ text: "0" });
    expect(coerceCellValue(12.5)).toEqual({ text: "12.5" });
    expect(coerceCellValue(true)).toEqual({ text: "TRUE" });
    expect(coerceCellValue(null)).toEqual({ text: "" });
    expect(coerceCellValue(undefined)).toEqual({ text: "" });
  });

  it("joins richText runs", () => {
    expect(
      coerceCellValue({ richText: [{ text: "Hello " }, { text: "world" }] })
    ).toEqual({ text: "Hello world" });
  });

  it("recurses through hyperlinks, including richText inside", () => {
    expect(
      coerceCellValue({ hyperlink: "https://x", text: "label" })
    ).toEqual({ text: "label" });
    expect(
      coerceCellValue({ hyperlink: "https://x", text: { richText: [{ text: "rt" }] } })
    ).toEqual({ text: "rt" });
  });

  it("uses cached formula results and errors when absent", () => {
    expect(coerceCellValue({ formula: "A1&B1", result: "joined" })).toEqual({
      text: "joined",
    });
    const missing = coerceCellValue({ formula: "A1&B1" });
    expect("cellError" in missing && missing.cellError).toMatch(/re-save/);
  });

  it("errors on Date and Excel error cells", () => {
    const date = coerceCellValue(new Date("2026-01-02"));
    expect("cellError" in date && date.cellError).toMatch(/date/);
    const err = coerceCellValue({ error: "#DIV/0!" });
    expect("cellError" in err && err.cellError).toContain("#DIV/0!");
  });

  it("surfaces a date cell as a row error naming the column", () => {
    const a = run([goodRow({ optionB: new Date("2026-01-02") })]);
    expect(errorsOf(a, 2).some((m) => m.startsWith("Option B") && m.includes("date"))).toBe(true);
  });
});

// ── Field parsing ───────────────────────────────────────────

describe("type and difficulty", () => {
  it("defaults blank type to single and blank difficulty to medium", () => {
    const a = run([goodRow({ type: "", difficulty: "" })]);
    expect(a.validRows[0].input.type).toBe("mcq_single");
    expect(a.validRows[0].input.difficulty).toBe("medium");
  });

  it("accepts mcq_single / mcq_multi aliases", () => {
    const a = run([
      goodRow({ type: "MCQ_SINGLE" }),
      goodRow({
        type: "mcq_multi",
        stem: "Which of the following are true of nephrotic syndrome? Select all that apply.",
        optionA: "Proteinuria",
        optionB: "Hypoalbuminaemia",
        correct: "A,B",
      }),
    ]);
    expect(a.counts.valid).toBe(2);
    expect(a.validRows[1].input.type).toBe("mcq_multi");
  });

  it("rejects image rows with a pointer to the editor", () => {
    const a = run([goodRow({ type: "image" })]);
    expect(errorsOf(a, 2)[0]).toMatch(/editor/i);
  });

  it("rejects unknown type and difficulty values", () => {
    const a = run([goodRow({ type: "essay" }), goodRow({ difficulty: "extreme" })]);
    expect(errorsOf(a, 2)[0]).toContain('"essay"');
    expect(errorsOf(a, 3)[0]).toContain('"extreme"');
  });
});

describe("correct-letter parsing", () => {
  it("accepts separators: comma, semicolon, whitespace — case-insensitive", () => {
    const multi = {
      type: "multi",
      stem: "Which of the following are recognised features of acute mesenteric ischaemia?",
      optionA: "Pain out of proportion",
      optionB: "Raised lactate",
      optionC: "Bradycardia",
    };
    for (const correct of ["A,B", "a b", "A;B", " a ,B "]) {
      const a = run([goodRow({ ...multi, correct })]);
      expect(a.counts.valid, `correct="${correct}"`).toBe(1);
    }
  });

  it("rejects bare 'AC' as one token", () => {
    const a = run([goodRow({ correct: "AC" })]);
    expect(errorsOf(a, 2)[0]).toContain('"AC"');
  });

  it("rejects out-of-range letters, duplicates, and empty", () => {
    expect(errorsOf(run([goodRow({ correct: "I" })]), 2)[0]).toContain('"I"');
    expect(errorsOf(run([goodRow({ correct: "A,A" })]), 2)[0]).toMatch(/more than once/);
    expect(errorsOf(run([goodRow({ correct: "" })]), 2)[0]).toMatch(/Correct is required/);
  });

  it("errors when Correct points at a blank option cell", () => {
    const a = run([goodRow({ correct: "C" })]); // option C not filled
    expect(errorsOf(a, 2)[0]).toContain("Option C");
    expect(errorsOf(a, 2)[0]).toMatch(/empty/);
  });

  it("errors when Correct points at a column missing from the file", () => {
    const header = COLUMNS.filter((c) => c.key !== "optionC").map((c) => c.header);
    const a = parseMatrix(
      {
        header,
        rows: [
          {
            rowNumber: 2,
            cells: header.map((h) => {
              const def = COLUMNS.find((c) => c.header === h)!;
              return (goodRow({ correct: "C" }) as Record<string, unknown>)[def.key] ?? "";
            }),
          },
        ],
      },
      TAXONOMY,
      { autoCreateTaxonomy: true, forcedExam: FORCED }
    );
    expect(errorsOf(a, 2)[0]).toMatch(/Option C.*not in this file/);
  });

  it("allows gaps between filled option columns", () => {
    // A and C filled, B blank — C stays C because letters bind to headers.
    const a = run([goodRow({ optionB: "", optionC: "Pericarditis", correct: "A" })]);
    expect(a.counts.valid).toBe(1);
    expect(a.validRows[0].input.options).toHaveLength(2);
  });
});

// ── Schema enforcement through the core ─────────────────────

describe("schema rules surface as row errors", () => {
  it("maps option-path issues back to the sheet letter", () => {
    // Duplicate labels: schema flags options.1.label — sheet letter B.
    const a = run([goodRow({ optionB: "Stable angina" })]);
    expect(errorsOf(a, 2)[0]).toMatch(/^Option B: Duplicate option text/);
  });

  it("enforces correct-count rules by type", () => {
    const single = run([
      goodRow({ optionC: "Oesophagitis", correct: "A,C" }),
    ]);
    expect(errorsOf(single, 2)[0]).toMatch(/exactly one/i);

    const multi = run([
      goodRow({
        type: "multi",
        stem: "Which of the following are recognised causes of pancreatitis?",
        correct: "A",
      }),
    ]);
    expect(errorsOf(multi, 2)[0]).toMatch(/at least two correct/i);
  });

  it("enforces stem/explanation minimum length (no max)", () => {
    expect(errorsOf(run([goodRow({ stem: "x".repeat(9) })]), 2).length).toBeGreaterThan(0);
    expect(run([goodRow({ stem: "x".repeat(10) })]).counts.valid).toBe(1);
    expect(run([goodRow({ stem: "x".repeat(5001) })]).counts.valid).toBe(1);
    expect(errorsOf(run([goodRow({ explanation: "short" })]), 2).length).toBeGreaterThan(0);
    expect(run([goodRow({ explanation: "y".repeat(5001) })]).counts.valid).toBe(1);
  });

  it("enforces option label length 500/501", () => {
    expect(run([goodRow({ optionB: "y".repeat(500) })]).counts.valid).toBe(1);
    expect(errorsOf(run([goodRow({ optionB: "y".repeat(501) })]), 2).length).toBeGreaterThan(0);
  });

  it("keeps an option labelled '0' (no falsiness bug)", () => {
    const a = run([goodRow({ optionB: 0 })]);
    expect(a.counts.valid).toBe(1);
    expect(a.validRows[0].input.options.map((o) => o.label)).toContain("0");
  });

  it("treats whitespace-only and NBSP-only cells as blank", () => {
    const a = run([goodRow({ optionC: "      " })]);
    expect(a.counts.valid).toBe(1);
    expect(a.validRows[0].input.options).toHaveLength(2);
  });
});

// ── Taxonomy resolution ─────────────────────────────────────

describe("taxonomy", () => {
  it("resolves an existing subject case-insensitively", () => {
    const a = run([goodRow({ subject: "  medicine " })]);
    expect(a.counts.valid).toBe(1);
    expect(a.validRows[0].input.subjectId).toBe(
      "11111111-1111-1111-1111-111111111111"
    );
    expect(a.creationPlan.subjects).toEqual([]);
  });

  it("plans creation once per entity across many rows (casefold dedupe)", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      goodRow({
        subject: i % 2 ? "Ophthalmology" : "OPHTHALMOLOGY",
        stem: `Question number ${i} about retinal disease, padded to length.`,
      })
    );
    const a = run(rows);
    expect(a.creationPlan.subjects).toHaveLength(1);
    expect(a.counts.valid).toBe(30);
    expect(a.validRows.every((r) => r.input.subjectId === PLACEHOLDER_SUBJECT_ID)).toBe(true);
    // One info line for the one created entity, not per row.
    expect(a.lines.filter((l) => l.severity === "info")).toHaveLength(1);
  });

  it("resolves the same subject name under two different specialties separately", () => {
    // Imports are locked to one exam per upload, so cross-exam composite
    // keying is exercised as two separate runs, one per forced exam.
    const defaultExamRun = run([goodRow({ subject: "Emergencies" })]);
    const usmleRun = run(
      [
        goodRow({
          specialty: "Internal Medicine",
          subject: "Emergencies",
          stem: "A different stem for the USMLE emergencies question here.",
        }),
      ],
      { forcedExam: USMLE }
    );
    expect(defaultExamRun.creationPlan.subjects).toEqual([
      {
        examName: "Medical Board Exam",
        specialtyName: "General",
        name: "Emergencies",
      },
    ]);
    expect(usmleRun.creationPlan.subjects).toEqual([
      {
        examName: "USMLE",
        specialtyName: "Internal Medicine",
        name: "Emergencies",
      },
    ]);
  });

  it("turns an unknown subject into a row error when auto-create is off", () => {
    const a = run([goodRow({ subject: "Ophthalmology" })], {
      autoCreate: false,
    });
    expect(a.counts.valid).toBe(0);
    expect(errorsOf(a, 2)[0]).toMatch(/Subject "Ophthalmology" doesn't exist/);
  });
});

// ── Exam / Specialty levels ─────────────────────────────────

describe("exam and specialty resolution", () => {
  it("blank Exam resolves to the forced exam, and blank Specialty to the default when forced IS the default", () => {
    const a = run([goodRow()]);
    expect(a.counts.valid).toBe(1);
    expect(a.validRows[0].examName).toBe("Medical Board Exam");
    expect(a.validRows[0].specialtyName).toBe("General");
    expect(a.validRows[0].input.subjectId).toBe(
      "11111111-1111-1111-1111-111111111111"
    );
  });

  it("explicit exam name matching the forced exam (case-insensitive) with blank Specialty resolves to the default specialty", () => {
    const a = run([goodRow({ exam: "medical board exam" })]);
    expect(a.counts.valid).toBe(1);
    // The sheet's literal (matching) text passes through unchanged.
    expect(a.validRows[0].examName).toBe("medical board exam");
    expect(a.validRows[0].specialtyName).toBe("General");
  });

  it("blank Specialty under a forced NON-default exam is a row error", () => {
    const a = run([goodRow()], { forcedExam: USMLE });
    expect(errorsOf(a, 2)[0]).toMatch(/Specialty is required when Exam is not the default/);
  });

  it("a sheet Exam value that doesn't match the forced exam is a row error, never a new exam", () => {
    const a = run([goodRow({ exam: "USMLE" })]); // forcedExam defaults to Medical Board Exam
    expect(a.counts.valid).toBe(0);
    expect(errorsOf(a, 2)[0]).toMatch(/Exam must be/);
    expect(a.creationPlan.exams).toEqual([]);
  });

  it("blank Exam still resolves to the forced exam even when the snapshot's default exam name is null", () => {
    const a = run([goodRow({ specialty: "General" })], {
      taxonomy: { ...TAXONOMY, defaultExamName: null },
    });
    expect(a.counts.valid).toBe(1);
    expect(a.validRows[0].examName).toBe("Medical Board Exam");
  });

  it("an unrecognised sheet Exam name is a mismatch error — exams are never auto-created", () => {
    const rows = [
      goodRow({ exam: "PLAB", specialty: "Clinical", subject: "Anatomy" }),
      goodRow({
        exam: "plab",
        specialty: "CLINICAL",
        subject: "anatomy",
        stem: "A second question about thoracic anatomy, padded for length rules.",
      }),
    ];
    const a = run(rows);
    expect(a.counts.valid).toBe(0);
    expect(errorsOf(a, 2)[0]).toMatch(/Exam must be/);
    expect(errorsOf(a, 3)[0]).toMatch(/Exam must be/);
    expect(a.creationPlan.exams).toEqual([]);
    expect(a.creationPlan.specialties).toEqual([]);
    expect(a.creationPlan.subjects).toEqual([]);
  });

  it("a forcedExam absent from the taxonomy snapshot is a row error naming it (defensive)", () => {
    const ghostExam = { id: "e0000000-0000-0000-0000-000000000099", name: "Ghost Exam" };
    const a = run(
      [goodRow({ specialty: "Clinical", subject: "Anatomy" })],
      { forcedExam: ghostExam }
    );
    expect(errorsOf(a, 2)[0]).toMatch(/Exam "Ghost Exam" doesn't exist/);
    expect(a.creationPlan.exams).toEqual([]);
  });

  it("unknown specialty under an existing forced exam plans only specialty and subject", () => {
    const a = run(
      [goodRow({ specialty: "Surgery Shelf", subject: "Anatomy" })],
      { forcedExam: USMLE }
    );
    expect(a.creationPlan.exams).toEqual([]);
    expect(a.creationPlan.specialties).toEqual([
      { examName: "USMLE", name: "Surgery Shelf" },
    ]);
    expect(a.creationPlan.subjects).toHaveLength(1);
  });

  it("creationPlan.exams stays empty even with auto-create on and a brand-new specialty/subject", () => {
    const a = run(
      [goodRow({ specialty: "Brand New Specialty", subject: "Brand New Subject" })],
      { forcedExam: USMLE, autoCreate: true }
    );
    expect(a.counts.valid).toBe(1);
    expect(a.creationPlan.exams).toEqual([]);
    expect(a.creationPlan.specialties).toHaveLength(1);
    expect(a.creationPlan.subjects).toHaveLength(1);
  });

  it("the same subject name resolves to a different id depending on which exam is forced", () => {
    const defaultExamRun = run([goodRow()]); // General › Medicine under Medical Board Exam
    const usmleRun = run(
      [
        goodRow({
          specialty: "Internal Medicine",
          subject: "Medicine",
          stem: "A USMLE-style cardiology question with a distinct stem for this test.",
        }),
      ],
      { forcedExam: USMLE }
    );
    expect(defaultExamRun.counts.valid).toBe(1);
    expect(usmleRun.counts.valid).toBe(1);
    expect(defaultExamRun.validRows[0].input.subjectId).toBe(
      "11111111-1111-1111-1111-111111111111"
    );
    expect(usmleRun.validRows[0].input.subjectId).toBe(
      "99999999-9999-9999-9999-999999999999"
    );
  });

  it("the same NEW subject name under two forced exams plans a distinct creation each time", () => {
    const defaultExamRun = run([goodRow({ subject: "Pharmacology" })]);
    const usmleRun = run(
      [
        goodRow({
          specialty: "Internal Medicine",
          subject: "Pharmacology",
          stem: "A second pharmacology stem so the duplicate-stem warning stays out of the way.",
        }),
      ],
      { forcedExam: USMLE }
    );
    expect(defaultExamRun.creationPlan.subjects).toHaveLength(1);
    expect(usmleRun.creationPlan.subjects).toHaveLength(1);
  });
});

describe("legacy sheets without Exam/Specialty columns", () => {
  it("parses with default fallback (old template keeps importing)", () => {
    const a = runLegacy([goodRow()]);
    expect(a.fileErrors).toEqual([]);
    expect(a.counts.valid).toBe(1);
    expect(a.validRows[0].examName).toBe("Medical Board Exam");
    expect(a.validRows[0].specialtyName).toBe("General");
    expect(a.validRows[0].input.subjectId).toBe(
      "11111111-1111-1111-1111-111111111111"
    );
  });

  it("still skips untouched old-template example rows", () => {
    // The old template's example rows have no exam/specialty fields at all;
    // isExampleRow must ignore columns absent from the sheet.
    const legacyExample = Object.fromEntries(
      LEGACY_COLUMNS.map((c) => [c.key, EXAMPLE_ROWS[0][c.key] ?? ""])
    );
    const a = runLegacy([legacyExample, goodRow()]);
    expect(a.counts.skipped).toBe(1);
    expect(a.counts.valid).toBe(1);
  });
});

// ── Duplicates, examples, caps, numbering ───────────────────

describe("duplicate stems in-file", () => {
  it("warns (not errors) with the first row number, tolerant of case/whitespace", () => {
    const a = run([
      goodRow(),
      goodRow({ stem: `  ${String(goodRow().stem).toUpperCase()}  ` }),
    ]);
    expect(a.counts.valid).toBe(2);
    const warning = a.lines.find((l) => l.severity === "warning");
    expect(warning?.row).toBe(3);
    expect(warning?.message).toContain("row 2");
  });
});

describe("template example rows", () => {
  const exampleAsRow = (i: number) =>
    Object.fromEntries(
      COLUMNS.map((c) => [c.key, EXAMPLE_ROWS[i][c.key] ?? ""])
    );

  it("skips untouched example rows with info severity", () => {
    const a = run([exampleAsRow(0), exampleAsRow(1), goodRow()]);
    expect(a.counts.skipped).toBe(2);
    expect(a.counts.valid).toBe(1);
    expect(
      a.lines.filter((l) => l.severity === "info" && /example row/i.test(l.message))
    ).toHaveLength(2);
  });

  it("treats a MODIFIED example row as real data", () => {
    const modified = { ...exampleAsRow(0), optionC: "Left main stem" };
    const a = run([modified]);
    expect(a.counts.skipped).toBe(0);
    // Real data → validated normally (valid here).
    expect(a.counts.valid).toBe(1);
  });
});

describe("row cap and numbering", () => {
  it("accepts exactly the cap and file-errors one past it — never truncates", () => {
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        goodRow({ stem: `Unique stem number ${i} padded out to satisfy length rules.` })
      );
    expect(run(mk(IMPORT_ROW_CAP)).fileErrors).toEqual([]);
    const over = run(mk(IMPORT_ROW_CAP + 1));
    // Assert against the constant, not a literal — the cap is a tuning knob
    // and this test is about the message naming it, not about its value.
    expect(over.fileErrors[0]).toContain(`limit is ${IMPORT_ROW_CAP}`);
    expect(over.validRows).toEqual([]);
  });

  it("reports spreadsheet row numbers, skipping blank rows without renumbering", () => {
    const a = parseMatrix(
      {
        header: HEADERS,
        rows: [
          { rowNumber: 2, cells: cells(goodRow()) },
          { rowNumber: 3, cells: cells({}) }, // blank
          { rowNumber: 4, cells: cells(goodRow({ correct: "" })) },
        ],
      },
      TAXONOMY,
      { autoCreateTaxonomy: true, forcedExam: FORCED }
    );
    expect(a.validRows[0].rowNumber).toBe(2);
    expect(errorsOf(a, 4).length).toBeGreaterThan(0);
    expect(a.lines.filter((l) => l.row === 3)).toEqual([]);
  });
});

// ── Parity guarantee ────────────────────────────────────────

describe("preview/commit parity", () => {
  it("the same matrix yields identical accept/reject sets on repeat runs", () => {
    const rows = [
      goodRow(),
      goodRow({ correct: "Z" }),
      goodRow({ subject: "NewSubject" }),
    ];
    const first = run(rows);
    const second = run(rows);
    expect(second.validRows.map((r) => r.rowNumber)).toEqual(
      first.validRows.map((r) => r.rowNumber)
    );
    expect(second.lines).toEqual(first.lines);
    expect(second.counts).toEqual(first.counts);
  });
});

describe("normalizeStem", () => {
  it("collapses whitespace and casefolds", () => {
    expect(normalizeStem("  A   Stem Here ")).toBe("a stem here");
  });
});

describe("template columns vs parser columns", () => {
  it("keeps Type and Difficulty out of the template but still parses them", () => {
    const templateKeys = COLUMNS.filter((c) => c.inTemplate !== false).map(
      (c) => c.key
    );
    for (const key of ["type", "difficulty"]) {
      // Absent from the generated file...
      expect(templateKeys).not.toContain(key);
      // ...but still a column the parser understands, so sheets built from an
      // older template keep filing exactly where they used to.
      expect(COLUMNS.map((c) => c.key)).toContain(key);
    }
  });

  it("excludes Exam from the generated template — the exam is chosen on its page", () => {
    expect(TEMPLATE_HEADERS).not.toContain("Exam");
    // ...but a sheet built from an older template that still carries it parses fine.
    expect(COLUMNS.map((c) => c.key)).toContain("exam");
  });
});

describe("legacy Topic column", () => {
  it("ignores a Topic column entirely — no error, no plan, no effect on resolution", () => {
    const header = [...HEADERS, "Topic"];
    const a = parseMatrix(
      {
        header,
        rows: [{ rowNumber: 2, cells: [...cells(goodRow()), "Cardiology"] }],
      },
      TAXONOMY,
      { autoCreateTaxonomy: true, forcedExam: FORCED }
    );
    expect(a.fileErrors).toEqual([]);
    expect(a.counts.valid).toBe(1);
    expect(a.validRows[0].input.subjectId).toBe(
      "11111111-1111-1111-1111-111111111111"
    );
    expect(a.creationPlan.subjects).toEqual([]);
  });
});
