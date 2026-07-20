import { questionSchema, type QuestionInput } from "@/lib/validation";

/**
 * Pure core of the bulk question importer.
 *
 * Deliberately free of exceljs and of any `server-only` import so Vitest can
 * cover every rule without touching a workbook: the server boundary
 * (lib/admin/import.ts) reduces an .xlsx to a plain cell matrix and this
 * module does everything else. Preview and commit both run through here, so
 * the two paths cannot drift.
 */

export const IMPORT_ROW_CAP = 500;

/**
 * Stand-in topicId for rows whose subject/topic will be auto-created at
 * commit. All-zeros is a valid Postgres uuid (and passes z.guid()), so rows
 * can be schema-validated at preview time before the real id exists.
 */
export const PLACEHOLDER_TOPIC_ID = "00000000-0000-0000-0000-000000000000";

export const OPTION_LETTERS = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
] as const;
export type OptionLetter = (typeof OPTION_LETTERS)[number];

export type ColumnDef = {
  key: string;
  header: string;
  /** File-level requirement: the COLUMN must exist in the sheet. */
  required: boolean;
  /** Template: header-cell note documenting the rules. */
  note: string;
  /** Template: column width. */
  width: number;
  /** Template: wrap text in data cells. */
  wrap?: boolean;
  /** Template: inline-list dropdown values. */
  dropdown?: readonly string[];
};

/** Single source of truth for the parser AND the downloadable template. */
export const COLUMNS: readonly ColumnDef[] = [
  {
    key: "subject",
    header: "Subject",
    required: true,
    note: "Required. Subject name. Unknown names are created automatically when auto-create is enabled.",
    width: 18,
  },
  {
    key: "topic",
    header: "Topic",
    required: true,
    note: "Required. Topic name within the subject.",
    width: 24,
  },
  {
    key: "type",
    header: "Type",
    required: false,
    note: "Optional. single or multi (default single). Image questions must be created in the editor.",
    width: 10,
    dropdown: ["single", "multi"],
  },
  {
    key: "difficulty",
    header: "Difficulty",
    required: false,
    note: "Optional. easy, medium or hard (default medium).",
    width: 12,
    dropdown: ["easy", "medium", "hard"],
  },
  {
    key: "stem",
    header: "Stem",
    required: true,
    note: "Required. The question text, 10-5000 characters.",
    width: 64,
    wrap: true,
  },
  {
    key: "explanation",
    header: "Explanation",
    required: true,
    note: "Required. Shown in review after submitting, 10-5000 characters.",
    width: 56,
    wrap: true,
  },
  ...OPTION_LETTERS.map(
    (letter): ColumnDef => ({
      key: `option${letter}`,
      header: `Option ${letter}`,
      // At least two option columns must exist for a valid sheet.
      required: letter === "A" || letter === "B",
      note:
        letter === "A" || letter === "B"
          ? "Required column. Answer option text, up to 500 characters."
          : "Optional column. Leave the cell empty when unused.",
      width: 28,
      wrap: true,
    })
  ),
  {
    key: "correct",
    header: "Correct",
    required: true,
    note: 'Required. Letters of the correct option column(s), e.g. "A" or "A,C". Multi questions need at least two.',
    width: 10,
  },
];

/**
 * Template example rows. The parser recognises an UNMODIFIED example row and
 * skips it (info severity) so uploading the untouched template can never
 * create junk questions. Any edit makes the row real data.
 */
export const EXAMPLE_ROWS: readonly Record<string, string>[] = [
  {
    subject: "Medicine",
    topic: "Cardiology",
    type: "single",
    difficulty: "medium",
    stem: "EXAMPLE - A 58-year-old man presents with crushing central chest pain. ECG shows ST elevation in leads II, III and aVF. Which coronary artery is most likely occluded?",
    explanation:
      "EXAMPLE - The inferior leads (II, III, aVF) localise to the right coronary artery in most patients. Delete this row before importing your own questions.",
    optionA: "Right coronary artery",
    optionB: "Left anterior descending artery",
    optionC: "Left circumflex artery",
    correct: "A",
  },
  {
    subject: "Medicine",
    topic: "Endocrinology",
    type: "multi",
    difficulty: "hard",
    stem: "EXAMPLE - Which of the following support a diagnosis of Graves disease? Select all that apply.",
    explanation:
      "EXAMPLE - Exophthalmos and positive TSH-receptor antibodies are both characteristic of Graves disease. Delete this row before importing your own questions.",
    optionA: "Exophthalmos",
    optionB: "Positive TSH-receptor antibodies",
    optionC: "A single hot thyroid nodule",
    correct: "A,B",
  },
];

export type Severity = "error" | "warning" | "info";

export type ReportLine = {
  /** Spreadsheet row number (header = 1, data starts at 2); null = file-level. */
  row: number | null;
  severity: Severity;
  message: string;
};

export type ValidRow = {
  rowNumber: number;
  subjectName: string;
  topicName: string;
  /** Ready for questionSchema/insert; topicId may be the placeholder. */
  input: QuestionInput;
  /** Normalised stem, for duplicate detection against the DB. */
  stemNorm: string;
};

export type CreationPlan = {
  subjects: { name: string }[];
  topics: { subjectName: string; name: string }[];
};

export type ImportAnalysis = {
  /** File-level problems that prevent any import at all. */
  fileErrors: string[];
  lines: ReportLine[];
  validRows: ValidRow[];
  creationPlan: CreationPlan;
  counts: {
    dataRows: number;
    valid: number;
    errorRows: number;
    warnings: number;
    skipped: number;
  };
};

export type TaxonomySnapshot = {
  subjects: {
    id: string;
    name: string;
    topics: { id: string; name: string }[];
  }[];
};

// ── Normalisation helpers ───────────────────────────────────

const NBSP = / /g;

/** Header/name matching: trim, collapse whitespace, casefold, drop NBSP. */
export function normalizeKey(value: string): string {
  return value.replace(NBSP, " ").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Stem comparison for duplicate detection (in-file and against the DB). */
export function normalizeStem(value: string): string {
  return normalizeKey(value);
}

// ── Cell coercion ───────────────────────────────────────────

export type CoercedCell = { text: string } | { cellError: string };

/**
 * Turn an exceljs `cell.value` (a plain structural value — no exceljs types
 * needed) into a string, or a cell-level error for the shapes that indicate
 * the sheet will not round-trip faithfully.
 *
 * Never use exceljs's `cell.text`: it silently stringifies error cells to
 * "#N/A", formulas without cached results to "", and Dates to a
 * locale-dependent string.
 */
export function coerceCellValue(value: unknown): CoercedCell {
  if (value === null || value === undefined) return { text: "" };
  if (typeof value === "string") return { text: value };
  if (typeof value === "number") return { text: String(value) };
  if (typeof value === "boolean") return { text: value ? "TRUE" : "FALSE" };

  if (value instanceof Date) {
    return {
      cellError:
        "looks like a date — Excel auto-converted this value. Format the column as Text and re-enter it.",
    };
  }

  if (typeof value === "object") {
    const v = value as Record<string, unknown>;

    if (Array.isArray(v.richText)) {
      return {
        text: (v.richText as { text?: unknown }[])
          .map((run) => (typeof run.text === "string" ? run.text : ""))
          .join(""),
      };
    }

    if ("hyperlink" in v && "text" in v) {
      return coerceCellValue(v.text);
    }

    if ("formula" in v || "sharedFormula" in v) {
      if (v.result === undefined) {
        return {
          cellError:
            "is a formula with no cached result — open the file in Excel and re-save it.",
        };
      }
      return coerceCellValue(v.result);
    }

    if (typeof v.error === "string") {
      return { cellError: `contains the Excel error ${v.error}.` };
    }
  }

  return { cellError: "has unsupported cell content." };
}

// ── Header mapping ──────────────────────────────────────────

type HeaderMap = Map<string, number>; // column key -> matrix index

function buildHeaderMap(header: unknown[]): {
  map: HeaderMap;
  errors: string[];
} {
  const map: HeaderMap = new Map();
  const errors: string[] = [];
  const byNormalizedHeader = new Map(
    COLUMNS.map((c) => [normalizeKey(c.header), c.key])
  );

  header.forEach((cell, index) => {
    const coerced = coerceCellValue(cell);
    if ("cellError" in coerced) return; // unusable header cell → treated as unknown
    const key = byNormalizedHeader.get(normalizeKey(coerced.text));
    if (!key) return; // unknown column: ignored by design
    if (map.has(key)) {
      errors.push(
        `The column "${COLUMNS.find((c) => c.key === key)!.header}" appears more than once.`
      );
      return;
    }
    map.set(key, index);
  });

  for (const column of COLUMNS) {
    if (column.required && !map.has(column.key)) {
      errors.push(`Missing required column "${column.header}".`);
    }
  }

  return { map, errors };
}

// ── Row parsing ─────────────────────────────────────────────

const TYPE_ALIASES: Record<string, "mcq_single" | "mcq_multi" | "image"> = {
  single: "mcq_single",
  mcq_single: "mcq_single",
  multi: "mcq_multi",
  mcq_multi: "mcq_multi",
  image: "image",
  image_based: "image",
  "image based": "image",
};

function isExampleRow(fields: Map<string, string>): boolean {
  return EXAMPLE_ROWS.some((example) =>
    COLUMNS.every((column) => {
      const expected = normalizeKey(example[column.key] ?? "");
      const actual = normalizeKey(fields.get(column.key) ?? "");
      return expected === actual;
    })
  );
}

export function parseMatrix(
  input: {
    header: unknown[];
    rows: { rowNumber: number; cells: unknown[] }[];
  },
  taxonomy: TaxonomySnapshot,
  opts: { autoCreateTaxonomy: boolean }
): ImportAnalysis {
  const lines: ReportLine[] = [];
  const validRows: ValidRow[] = [];
  const creationPlan: CreationPlan = { subjects: [], topics: [] };
  const counts = {
    dataRows: 0,
    valid: 0,
    errorRows: 0,
    warnings: 0,
    skipped: 0,
  };

  const { map: headerMap, errors: headerErrors } = buildHeaderMap(input.header);
  if (headerErrors.length > 0) {
    return {
      fileErrors: headerErrors,
      lines,
      validRows,
      creationPlan,
      counts,
    };
  }

  // Taxonomy lookups, casefolded once.
  const subjectsByName = new Map(
    taxonomy.subjects.map((s) => [normalizeKey(s.name), s])
  );
  const plannedSubjects = new Map<string, string>(); // norm -> display name
  const plannedTopics = new Map<string, { subjectName: string; name: string }>();

  const stemFirstRow = new Map<string, number>();

  // First pass: coerce + drop blank rows, so the row cap counts real data.
  type PreparedRow = {
    rowNumber: number;
    fields: Map<string, string>;
    cellErrors: string[];
  };
  const prepared: PreparedRow[] = [];

  for (const row of input.rows) {
    const fields = new Map<string, string>();
    const cellErrors: string[] = [];

    for (const column of COLUMNS) {
      const index = headerMap.get(column.key);
      if (index === undefined) {
        fields.set(column.key, "");
        continue;
      }
      const coerced = coerceCellValue(row.cells[index]);
      if ("cellError" in coerced) {
        cellErrors.push(`${column.header} ${coerced.cellError}`);
        fields.set(column.key, "");
      } else {
        fields.set(column.key, coerced.text.replace(NBSP, " ").trim());
      }
    }

    // Blank = every MAPPED column empty (content in unknown columns ignored).
    const isBlank =
      cellErrors.length === 0 &&
      [...fields.values()].every((v) => v === "");
    if (isBlank) continue;

    prepared.push({ rowNumber: row.rowNumber, fields, cellErrors });
  }

  if (prepared.length > IMPORT_ROW_CAP) {
    return {
      fileErrors: [
        `This file has ${prepared.length} data rows — the limit is ${IMPORT_ROW_CAP} per upload. Split it into smaller files (nothing was imported).`,
      ],
      lines,
      validRows,
      creationPlan,
      counts,
    };
  }

  for (const { rowNumber, fields, cellErrors } of prepared) {
    counts.dataRows += 1;
    const rowErrors: string[] = [...cellErrors];
    const rowWarnings: string[] = [];

    // Untouched template example rows are skipped, never imported.
    if (rowErrors.length === 0 && isExampleRow(fields)) {
      counts.skipped += 1;
      lines.push({
        row: rowNumber,
        severity: "info",
        message: "Example row from the template — skipped.",
      });
      continue;
    }

    const subjectName = fields.get("subject") ?? "";
    const topicName = fields.get("topic") ?? "";
    if (subjectName === "") rowErrors.push("Subject is required.");
    if (topicName === "") rowErrors.push("Topic is required.");

    // Type
    let type: "mcq_single" | "mcq_multi" = "mcq_single";
    const rawType = normalizeKey(fields.get("type") ?? "");
    if (rawType !== "") {
      const alias = TYPE_ALIASES[rawType];
      if (alias === "image") {
        rowErrors.push(
          "Image questions can't be bulk-imported — create them in the question editor, where the image can be uploaded."
        );
      } else if (!alias) {
        rowErrors.push(
          `Type "${fields.get("type")}" isn't recognised — use single or multi.`
        );
      } else {
        type = alias;
      }
    }

    // Difficulty
    let difficulty: "easy" | "medium" | "hard" = "medium";
    const rawDifficulty = normalizeKey(fields.get("difficulty") ?? "");
    if (rawDifficulty !== "") {
      if (
        rawDifficulty === "easy" ||
        rawDifficulty === "medium" ||
        rawDifficulty === "hard"
      ) {
        difficulty = rawDifficulty;
      } else {
        rowErrors.push(
          `Difficulty "${fields.get("difficulty")}" isn't recognised — use easy, medium or hard.`
        );
      }
    }

    // Options by letter (letters are bound to header names, so a reordered
    // or deleted column can never silently shift meaning).
    const optionByLetter = new Map<OptionLetter, string>();
    for (const letter of OPTION_LETTERS) {
      const label = fields.get(`option${letter}`) ?? "";
      if (label !== "") optionByLetter.set(letter, label);
    }

    // Correct letters
    const correctRaw = fields.get("correct") ?? "";
    const correctLetters = new Set<OptionLetter>();
    if (correctRaw === "") {
      rowErrors.push('Correct is required — the letter(s) of the correct option(s), e.g. "A" or "A,C".');
    } else {
      const tokens = correctRaw
        .split(/[\s,;]+/)
        .map((t) => t.trim())
        .filter((t) => t !== "");
      for (const token of tokens) {
        const upper = token.toUpperCase();
        if (!/^[A-H]$/.test(upper)) {
          rowErrors.push(
            `Correct contains "${token}" — use single letters A-H separated by commas.`
          );
          continue;
        }
        const letter = upper as OptionLetter;
        if (!headerMap.has(`option${letter}`)) {
          rowErrors.push(
            `Correct references Option ${letter}, but that column is not in this file.`
          );
          continue;
        }
        if (correctLetters.has(letter)) {
          rowErrors.push(`Correct lists ${letter} more than once.`);
          continue;
        }
        if (!optionByLetter.has(letter)) {
          rowErrors.push(
            `Correct references Option ${letter}, but that cell is empty on this row.`
          );
          continue;
        }
        correctLetters.add(letter);
      }
    }

    // Taxonomy resolution
    let topicId = PLACEHOLDER_TOPIC_ID;
    if (subjectName !== "" && topicName !== "") {
      const subjectNorm = normalizeKey(subjectName);
      const topicNorm = normalizeKey(topicName);
      const existingSubject = subjectsByName.get(subjectNorm);
      const existingTopic = existingSubject?.topics.find(
        (t) => normalizeKey(t.name) === topicNorm
      );

      if (existingTopic) {
        topicId = existingTopic.id;
      } else if (!opts.autoCreateTaxonomy) {
        rowErrors.push(
          existingSubject
            ? `Topic "${topicName}" doesn't exist under "${subjectName}". Create it first, or enable auto-create.`
            : `Subject "${subjectName}" doesn't exist. Create it first, or enable auto-create.`
        );
      } else {
        if (!existingSubject && !plannedSubjects.has(subjectNorm)) {
          plannedSubjects.set(subjectNorm, subjectName);
          creationPlan.subjects.push({ name: subjectName });
          lines.push({
            row: rowNumber,
            severity: "info",
            message: `Will create subject "${subjectName}".`,
          });
        }
        const topicPlanKey = `${subjectNorm}::${topicNorm}`;
        if (!plannedTopics.has(topicPlanKey)) {
          plannedTopics.set(topicPlanKey, { subjectName, name: topicName });
          creationPlan.topics.push({ subjectName, name: topicName });
          lines.push({
            row: rowNumber,
            severity: "info",
            message: `Will create topic "${topicName}" under "${subjectName}".`,
          });
        }
      }
    }

    // Options array in letter order, correctness attached BEFORE compaction.
    const collected = [...optionByLetter.entries()].map(([letter, label]) => ({
      letter,
      label,
      isCorrect: correctLetters.has(letter),
    }));

    const candidate = {
      topicId,
      type,
      difficulty,
      stem: fields.get("stem") ?? "",
      explanation: fields.get("explanation") ?? "",
      imagePath: null,
      isPublished: false,
      options: collected.map(({ label, isCorrect }) => ({ label, isCorrect })),
    };

    // Full schema validation — the same rules the editor enforces.
    if (rowErrors.length === 0) {
      const parsed = questionSchema.safeParse(candidate);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          // Map options.N.* paths back to the sheet's column letter.
          if (issue.path[0] === "options" && typeof issue.path[1] === "number") {
            const letter = collected[issue.path[1]]?.letter;
            rowErrors.push(
              letter ? `Option ${letter}: ${issue.message}` : issue.message
            );
          } else {
            rowErrors.push(issue.message);
          }
        }
      }
    }

    // In-file duplicate stems (warning — still importable).
    const stemNorm = normalizeStem(fields.get("stem") ?? "");
    if (rowErrors.length === 0 && stemNorm !== "") {
      const firstRow = stemFirstRow.get(stemNorm);
      if (firstRow !== undefined) {
        rowWarnings.push(`Duplicate of row ${firstRow} in this file.`);
      } else {
        stemFirstRow.set(stemNorm, rowNumber);
      }
    }

    if (rowErrors.length > 0) {
      counts.errorRows += 1;
      for (const message of rowErrors) {
        lines.push({ row: rowNumber, severity: "error", message });
      }
      continue;
    }

    counts.warnings += rowWarnings.length;
    for (const message of rowWarnings) {
      lines.push({ row: rowNumber, severity: "warning", message });
    }

    counts.valid += 1;
    validRows.push({
      rowNumber,
      subjectName,
      topicName,
      input: candidate,
      stemNorm,
    });
  }

  return { fileErrors: [], lines, validRows, creationPlan, counts };
}
