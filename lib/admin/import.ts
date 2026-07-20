import "server-only";

import { createHash } from "node:crypto";
import {
  COLUMNS,
  EXAMPLE_ROWS,
  IMPORT_ROW_CAP,
  PLACEHOLDER_TOPIC_ID,
  normalizeStem,
  parseMatrix,
  type ImportAnalysis,
  type ReportLine,
  type TaxonomySnapshot,
  type ValidRow,
} from "@/lib/admin/import-core";
import { createAdminClient } from "@/lib/supabase/admin";
import { listTaxonomy } from "@/lib/admin/taxonomy";

/**
 * The exceljs boundary of the bulk importer. Everything with rules lives in
 * lib/admin/import-core.ts (pure, unit-tested); this module only turns an
 * .xlsx into a plain cell matrix and builds the downloadable template.
 *
 * exceljs is imported lazily inside each function so it never lands in
 * shared server chunks — it is only paid for on the import endpoints.
 */

/** Bound scans so a sheet with formatting on row 1,000,000 can't hurt us. */
const MAX_SCAN_ROWS = 5000;
const MAX_SCAN_COLUMNS = 64;

const SHEET_NAME = "Questions";

export function sha256(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return createHash("sha256").update(bytes).digest("hex");
}

export type WorkbookMatrix = {
  header: unknown[];
  rows: { rowNumber: number; cells: unknown[] }[];
};

export async function workbookToMatrix(
  buffer: ArrayBuffer
): Promise<{ ok: true; matrix: WorkbookMatrix } | { ok: false; error: string }> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer);
  } catch {
    // Also covers legacy .xls, which exceljs cannot read.
    return {
      ok: false,
      error: "That file could not be read as an .xlsx workbook. Save it as .xlsx and try again.",
    };
  }

  // Prefer the sheet the template ships with; else the first visible sheet
  // (protects against user scratch sheets and hidden lookup sheets).
  const worksheet =
    workbook.getWorksheet(SHEET_NAME) ??
    workbook.worksheets.find((ws) => ws.state === "visible") ??
    workbook.worksheets[0];

  if (!worksheet) {
    return { ok: false, error: "The workbook has no worksheets." };
  }

  const readCells = (rowNumber: number): unknown[] => {
    const row = worksheet.getRow(rowNumber);
    const cells: unknown[] = [];
    for (let col = 1; col <= MAX_SCAN_COLUMNS; col++) {
      cells.push(row.getCell(col).value);
    }
    return cells;
  };

  const header = readCells(1);

  const rows: WorkbookMatrix["rows"] = [];
  // Never iterate rowCount blindly — bound the scan and let the core apply
  // its own row cap to the non-empty rows.
  const last = Math.min(worksheet.rowCount, MAX_SCAN_ROWS);
  for (let rowNumber = 2; rowNumber <= last; rowNumber++) {
    rows.push({ rowNumber, cells: readCells(rowNumber) });
  }

  if (worksheet.rowCount > MAX_SCAN_ROWS) {
    return {
      ok: false,
      error: `The sheet reports ${worksheet.rowCount} rows — far beyond the ${IMPORT_ROW_CAP}-row import limit. Split the file (nothing was imported).`,
    };
  }

  return { ok: true, matrix: { header, rows } };
}

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Shared front half of preview and commit: same file checks, same parse, same
 * taxonomy snapshot — the two endpoints cannot drift because this IS the
 * single path.
 */
export async function analyzeUpload(
  file: unknown,
  autoCreateTaxonomy: boolean
): Promise<
  | {
      ok: true;
      fileName: string;
      fileSha256: string;
      analysis: ImportAnalysis;
    }
  | { ok: false; error: string }
> {
  if (!(file instanceof File)) {
    return { ok: false, error: "Attach an .xlsx file." };
  }
  if (file.size === 0) {
    return { ok: false, error: "That file is empty." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: "Files are limited to 4 MB. Split the sheet and import in parts.",
    };
  }

  const buffer = await file.arrayBuffer();
  const matrixResult = await workbookToMatrix(buffer);
  if (!matrixResult.ok) return { ok: false, error: matrixResult.error };

  const taxonomy = await taxonomySnapshot();
  const analysis = parseMatrix(matrixResult.matrix, taxonomy, {
    autoCreateTaxonomy,
  });

  return {
    ok: true,
    fileName: file.name,
    fileSha256: sha256(buffer),
    analysis,
  };
}

async function taxonomySnapshot(): Promise<TaxonomySnapshot> {
  const subjects = await listTaxonomy();
  return {
    subjects: subjects.map((s) => ({
      id: s.id,
      name: s.name,
      topics: s.topics.map((t) => ({ id: t.id, name: t.name })),
    })),
  };
}

/**
 * Preview-only warnings: stems that already exist in the DB (excluding
 * soft-deleted questions — re-importing a stem you deleted is legitimate).
 *
 * Deliberately NOT `.in("stem", …)`: stems run to 5000 chars and supabase-js
 * puts .in() values in the URL, so a single long stem would 414 at the
 * gateway. Instead fetch candidate stems by target topic and compare
 * normalised in JS — the bank is small and the fetch is scoped.
 */
export async function dbDuplicateWarnings(
  validRows: readonly ValidRow[]
): Promise<ReportLine[]> {
  const topicIds = [
    ...new Set(
      validRows
        .map((r) => r.input.topicId)
        .filter((id) => id !== PLACEHOLDER_TOPIC_ID)
    ),
  ];
  if (topicIds.length === 0) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from("questions")
    .select("stem, topic_id")
    .in("topic_id", topicIds)
    .is("deleted_at", null);

  const byTopic = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    const set = byTopic.get(row.topic_id) ?? new Set<string>();
    set.add(normalizeStem(row.stem));
    byTopic.set(row.topic_id, set);
  }

  const warnings: ReportLine[] = [];
  for (const row of validRows) {
    if (byTopic.get(row.input.topicId)?.has(row.stemNorm)) {
      warnings.push({
        row: row.rowNumber,
        severity: "warning",
        message: `A question with this stem already exists in ${row.subjectName} › ${row.topicName}.`,
      });
    }
  }
  return warnings;
}

/**
 * Build the admin template workbook. Generated from the same COLUMNS module
 * the parser reads, so template and parser cannot drift.
 */
export async function buildTemplateBuffer(): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet(SHEET_NAME, {
    views: [{ state: "frozen", ySplit: 1 }], // keep the header on screen
  });

  ws.columns = COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
    style: {
      // Text format everywhere: stops Excel turning "1/2" into January 2nd,
      // the single ugliest corruption a medical MCQ sheet can suffer.
      numFmt: "@",
      alignment: column.wrap
        ? { wrapText: true, vertical: "top" }
        : { vertical: "top" },
    },
  }));

  // Header styling + per-column rules as notes.
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  COLUMNS.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.note = column.note;
    if (column.required) {
      cell.font = { bold: true, color: { argb: "FFC44A18" } };
    }
  });

  // Dropdowns for the enum columns. Assigned per-cell because exceljs's
  // shipped types don't expose worksheet.dataValidations; inline lists are
  // well under the 255-char formula limit.
  COLUMNS.forEach((column, index) => {
    if (!column.dropdown) return;
    const validation = {
      type: "list" as const,
      allowBlank: true,
      formulae: [`"${column.dropdown.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Invalid value",
      error: `Use one of: ${column.dropdown.join(", ")} (or leave blank for the default).`,
    };
    for (let rowNumber = 2; rowNumber <= IMPORT_ROW_CAP + 1; rowNumber++) {
      ws.getCell(rowNumber, index + 1).dataValidation = validation;
    }
  });

  // Example rows — the parser recognises these exact values and skips them.
  for (const example of EXAMPLE_ROWS) {
    ws.addRow(COLUMNS.map((column) => example[column.key] ?? ""));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  // writeBuffer returns a Node Buffer; copy into a standalone ArrayBuffer so
  // it satisfies BodyInit without byteOffset surprises.
  const bytes = new Uint8Array(buffer as unknown as Uint8Array);
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}
