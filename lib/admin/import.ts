import "server-only";

import { createHash } from "node:crypto";

import type { Workbook } from "exceljs";
import {
  COLUMNS,
  EXAMPLE_ROWS,
  IMPORT_ROW_CAP,
  PLACEHOLDER_SUBJECT_ID,
  TEMPLATE_VALIDATION_ROWS,
  coerceCellValue,
  normalizeKey,
  normalizeStem,
  parseMatrix,
  type ImportAnalysis,
  type ReportLine,
  type RowImageMeta,
  type TaxonomySnapshot,
  type ValidRow,
} from "@/lib/admin/import-core";
import {
  extractRowImages,
  fetchImageFromUrl,
  type EmbeddedImage,
} from "@/lib/admin/import-images";
import { createAdminClient } from "@/lib/supabase/admin";
import { listHierarchy } from "@/lib/admin/taxonomy";
import {
  extensionForType,
  isImportObjectPath,
  MAX_IMPORT_UPLOAD_BYTES,
  QUESTION_IMAGE_BUCKET,
  QUESTION_IMPORT_BUCKET,
} from "@/lib/storage";
import {
  DEFAULT_EXAM_ID,
  DEFAULT_SPECIALTY_ID,
} from "@/lib/taxonomy-defaults";

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
  rows: { rowNumber: number; cells: unknown[]; image?: RowImageMeta }[];
  imageWarnings: string[];
};

/**
 * Parts exceljs is known to trip over, dropped so a second load can succeed.
 *
 * Cell comments: exceljs walks the comment relationships while loading and
 * only understands Excel's own layout (`xl/commentsN.xml`, relative rel
 * targets). openpyxl and other generators write `xl/comments/commentN.xml`
 * with absolute targets, which makes exceljs dereference an unparsed part and
 * throw a TypeError that looks nothing like a format problem.
 *
 * Rich data: the parts behind Excel 365's in-cell pictures. exceljs has no
 * model for them at all. Images are read from the ORIGINAL buffer with JSZip
 * (lib/admin/import-images.ts), so removing them here costs nothing.
 *
 * Drawings (`drawings: true`, the last resort): exceljs only accepts a
 * drawing whose root tag carries Excel's own `xdr:` prefix, and it dereferences
 * a sheet's drawing relationship without checking the part parsed — so a
 * differently-namespaced or missing drawing throws
 * "Cannot read properties of undefined (reading 'anchors')" from deep inside
 * the loader. Anchored pictures are read from the original buffer too, so
 * dropping the parts costs the same nothing.
 *
 * Only cell values matter on this path, so nothing is lost either way.
 */
async function stripUnsupportedParts(
  buffer: ArrayBuffer,
  { drawings = false }: { drawings?: boolean } = {}
): Promise<ArrayBuffer> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  for (const path of Object.keys(zip.files)) {
    if (
      /^xl\/comments?[/\d]/i.test(path) ||
      /\.vml$/i.test(path) ||
      /^xl\/richData\//i.test(path) ||
      /^xl\/metadata\.xml$/i.test(path) ||
      (drawings && /^xl\/drawings\//i.test(path))
    ) {
      zip.remove(path);
    }
  }

  // Rels are the part that actually breaks the load: a dangling comments
  // relationship is dereferenced whether or not the target still exists.
  for (const path of Object.keys(zip.files)) {
    if (!/_rels\/[^/]*\.rels$/i.test(path)) continue;
    const xml = await zip.files[path].async("string");
    // The trailing quote anchors on the END of the Type URL, so this matches
    // `Type="…/richValueRel"` without also eating an unrelated Target path.
    const cleaned = xml.replace(/<Relationship\b[^>]*\/>/g, (rel) =>
      /(comments|vmlDrawing|richValueRel|rdRichValue|rdRichValueStructure|sheetMetadata)"/i.test(
        rel
      ) ||
      (drawings && /\/drawing"/i.test(rel))
        ? ""
        : rel
    );
    if (cleaned !== xml) zip.file(path, cleaned);
  }

  const contentTypes = zip.file("[Content_Types].xml");
  if (contentTypes) {
    const xml = await contentTypes.async("string");
    zip.file(
      "[Content_Types].xml",
      xml.replace(/<Override\b[^>]*\/>/g, (override) =>
        /comment|vml|richvalue|rdrichvalue|metadata/i.test(override) ||
        (drawings && /\/drawings\//i.test(override))
          ? ""
          : override
      )
    );
  }

  if (drawings) {
    // The relationship is gone, but the `<drawing r:id="…"/>` element that
    // referenced it would still send exceljs looking for a part that no
    // longer exists.
    for (const path of Object.keys(zip.files)) {
      if (!/^xl\/worksheets\/[^/]+\.xml$/i.test(path)) continue;
      const xml = await zip.files[path].async("string");
      const cleaned = xml.replace(
        /<(\w+:)?drawing\b[^>]*?(\/>|>[\s\S]*?<\/(\w+:)?drawing>)/g,
        ""
      );
      if (cleaned !== xml) zip.file(path, cleaned);
    }
  }

  const rebuilt = await zip.generateAsync({ type: "uint8array" });
  return rebuilt.buffer.slice(
    rebuilt.byteOffset,
    rebuilt.byteOffset + rebuilt.byteLength
  ) as ArrayBuffer;
}

/** Picture bytes, keyed by spreadsheet row. Never crosses into the pure core. */
export type ImagePayloads = Map<number, EmbeddedImage>;

export async function workbookToMatrix(
  buffer: ArrayBuffer
): Promise<
  | { ok: true; matrix: WorkbookMatrix; images: ImagePayloads }
  | { ok: false; error: string }
> {
  const ExcelJS = (await import("exceljs")).default;

  // Tried in order, each giving up more of what exceljs chokes on. Every
  // attempt starts from the untouched upload: the strips are independent, and
  // a workbook only reaches the last one if the milder ones failed.
  const attempts: { as: string; bytes: () => Promise<ArrayBuffer> }[] = [
    { as: "as uploaded", bytes: async () => buffer },
    { as: "without comments and rich data", bytes: () => stripUnsupportedParts(buffer) },
    {
      as: "without drawings",
      bytes: () => stripUnsupportedParts(buffer, { drawings: true }),
    },
  ];

  let workbook: Workbook | undefined;
  const failures: Record<string, unknown> = {};

  for (const attempt of attempts) {
    const candidate = new ExcelJS.Workbook();
    try {
      await candidate.xlsx.load(await attempt.bytes());
      workbook = candidate;
      break;
    } catch (error) {
      failures[attempt.as] = error;
    }
  }

  if (!workbook) {
    // Genuinely unreadable — legacy .xls, a renamed .csv, a corrupt zip.
    // Every cause is logged: the message below cannot describe them all.
    console.error("workbook_load_failed", failures);
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

  if (worksheet.rowCount > MAX_SCAN_ROWS) {
    return {
      ok: false,
      error: `The sheet reports ${worksheet.rowCount} rows — far beyond the ${IMPORT_ROW_CAP}-row import limit. Split the file (nothing was imported).`,
    };
  }

  // Images are matched to rows by their column, so the Image header has to be
  // located before extraction. exceljs columns are 1-based; the matrix is not.
  const imageHeaderIndex = header.findIndex((cell) => {
    const coerced = coerceCellValue(cell);
    return "text" in coerced && normalizeKey(coerced.text) === "image";
  });
  const { byRow, warnings } = await extractRowImages(
    buffer,
    workbook,
    worksheet,
    imageHeaderIndex >= 0 ? imageHeaderIndex + 1 : null
  );

  const rows: WorkbookMatrix["rows"] = [];
  // Never iterate rowCount blindly — bound the scan and let the core apply
  // its own row cap to the non-empty rows.
  const last = Math.min(worksheet.rowCount, MAX_SCAN_ROWS);
  for (let rowNumber = 2; rowNumber <= last; rowNumber++) {
    rows.push({
      rowNumber,
      cells: readCells(rowNumber),
      image: imageMeta(byRow.get(rowNumber)),
    });
  }

  return {
    ok: true,
    matrix: { header, rows, imageWarnings: warnings },
    images: byRow,
  };
}

/** Strip the bytes off an extracted image; only metadata reaches the core. */
function imageMeta(image: EmbeddedImage | undefined): RowImageMeta | undefined {
  if (!image) return undefined;
  return image.ok
    ? {
        kind: "embedded",
        sha256: image.sha256,
        contentType: image.contentType,
        byteLength: image.byteLength,
      }
    : { kind: "error", message: image.message };
}

/**
 * Shared front half of preview and commit: same file checks, same parse, same
 * taxonomy snapshot — the two endpoints cannot drift because this IS the
 * single path.
 *
 * Takes a Storage object path rather than an uploaded File. A sheet carrying
 * embedded pictures passes the serverless request-body limit after about ten
 * images, so the wizard puts the .xlsx in the question-imports bucket with a
 * signed URL and both endpoints read it from there. The sha256 handshake
 * between preview and commit is unchanged — it just hashes bytes that came
 * from Storage instead of from a multipart part.
 */
export async function analyzeUpload(
  objectPath: unknown,
  autoCreateTaxonomy: boolean,
  forcedExam: { id: string; name: string }
): Promise<
  | {
      ok: true;
      fileSha256: string;
      analysis: ImportAnalysis;
      images: ImagePayloads;
    }
  | { ok: false; error: string }
> {
  if (typeof objectPath !== "string" || !isImportObjectPath(objectPath)) {
    return { ok: false, error: "Upload the .xlsx again — its reference is missing or malformed." };
  }

  const { data, error } = await createAdminClient()
    .storage.from(QUESTION_IMPORT_BUCKET)
    .download(objectPath);

  if (error || !data) {
    return {
      ok: false,
      error: "That upload is no longer available — choose the file again.",
    };
  }
  if (data.size === 0) {
    return { ok: false, error: "That file is empty." };
  }
  // The bucket enforces this too; checking here turns a Storage-side rejection
  // into a message that names the actual limit.
  if (data.size > MAX_IMPORT_UPLOAD_BYTES) {
    return {
      ok: false,
      error: "Files are limited to 25 MB. Split the sheet and import in parts.",
    };
  }

  const buffer = await data.arrayBuffer();
  const matrixResult = await workbookToMatrix(buffer);
  if (!matrixResult.ok) return { ok: false, error: matrixResult.error };

  const taxonomy = await taxonomySnapshot();
  const analysis = parseMatrix(matrixResult.matrix, taxonomy, {
    autoCreateTaxonomy,
    forcedExam,
  });

  return {
    ok: true,
    fileSha256: sha256(buffer),
    analysis,
    images: matrixResult.images,
  };
}

// ── Image upload (commit only) ──────────────────────────────

export type UploadedImages = {
  /** Spreadsheet row → Storage path to write into questions.image_path. */
  pathByRow: Map<number, string>;
  /**
   * Paths this request actually created. Compensation deletes only these —
   * a content-addressed path that already existed belongs to an earlier
   * import, and removing it would blank the image on live questions.
   */
  created: string[];
  failures: { rowNumber: number; message: string }[];
};

/** Concurrent uploads in flight. Each is a Storage round-trip inside a 60s budget. */
const IMAGE_UPLOAD_CONCURRENCY = 6;

/**
 * Put every valid row's image in the question-images bucket.
 *
 * Paths are content-addressed (`q/import/<sha256>.<ext>`), which buys two
 * things: re-running the same import reuses the objects instead of littering
 * the bucket with copies, and a figure repeated across twenty questions is
 * stored once.
 */
export async function uploadRowImages(
  rows: readonly ValidRow[],
  payloads: ImagePayloads
): Promise<UploadedImages> {
  const targets = rows.filter((row) => row.image !== undefined);
  const result: UploadedImages = {
    pathByRow: new Map(),
    created: [],
    failures: [],
  };
  if (targets.length === 0) return result;

  const storage = createAdminClient().storage.from(QUESTION_IMAGE_BUCKET);

  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= targets.length) return;
      const row = targets[index];
      const ref = row.image!;

      let image: EmbeddedImage;
      if (ref.kind === "url") {
        image = await fetchImageFromUrl(ref.url);
      } else {
        const payload = payloads.get(row.rowNumber);
        image = payload ?? {
          ok: false,
          message: "the picture could not be read back from the file.",
        };
      }

      if (!image.ok) {
        result.failures.push({ rowNumber: row.rowNumber, message: image.message });
        continue;
      }

      const ext = extensionForType(image.contentType);
      if (!ext) {
        result.failures.push({
          rowNumber: row.rowNumber,
          message: "the picture is not a PNG, JPEG or WebP.",
        });
        continue;
      }

      const path = `q/import/${image.sha256}.${ext}`;
      const { error } = await storage.upload(path, image.bytes, {
        contentType: image.contentType,
        upsert: false,
      });

      if (error && !isDuplicateObject(error)) {
        console.error("import_image_upload_failed", { path, error });
        result.failures.push({
          rowNumber: row.rowNumber,
          message: "the picture could not be saved to storage.",
        });
        continue;
      }
      // No error means we created it; a duplicate means it was already there.
      if (!error) result.created.push(path);
      result.pathByRow.set(row.rowNumber, path);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(IMAGE_UPLOAD_CONCURRENCY, targets.length) }, worker)
  );

  return result;
}

/** Storage says 409/Duplicate when `upsert: false` hits an existing object. */
function isDuplicateObject(error: unknown): boolean {
  const e = error as { statusCode?: string | number; message?: string };
  return (
    String(e?.statusCode) === "409" || /already exists|duplicate/i.test(e?.message ?? "")
  );
}

/** Remove image objects a failed commit created. Mirrors question compensation. */
export async function deleteUploadedImages(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await createAdminClient()
    .storage.from(QUESTION_IMAGE_BUCKET)
    .remove([...paths]);
  if (error) console.error("import_image_cleanup_failed", { count: paths.length, error });
}

/** Best-effort cleanup of a workbook the importer is finished with. */
export async function deleteImportObject(objectPath: string): Promise<void> {
  if (!isImportObjectPath(objectPath)) return;
  const { error } = await createAdminClient()
    .storage.from(QUESTION_IMPORT_BUCKET)
    .remove([objectPath]);
  // An orphan in a private, admin-only bucket is not worth failing a
  // successful import over.
  if (error) console.error("import_object_cleanup_failed", { objectPath, error });
}

async function taxonomySnapshot(): Promise<TaxonomySnapshot> {
  const hierarchy = await listHierarchy();

  // Default names resolved by FIXED id, never by name — admins may rename
  // the default exam/specialty and blank cells must keep following them.
  const defaultExam = hierarchy.find((e) => e.id === DEFAULT_EXAM_ID) ?? null;
  const defaultSpecialty =
    hierarchy
      .flatMap((e) => e.specialties)
      .find((s) => s.id === DEFAULT_SPECIALTY_ID) ?? null;

  return {
    exams: hierarchy.map((exam) => ({
      id: exam.id,
      name: exam.name,
      specialties: exam.specialties.map((sp) => ({
        id: sp.id,
        name: sp.name,
        subjects: sp.subjects.map((s) => ({ id: s.id, name: s.name })),
      })),
    })),
    defaultExamName: defaultExam?.name ?? null,
    defaultSpecialtyName: defaultSpecialty?.name ?? null,
  };
}

/**
 * Preview-only warnings: stems that already exist in the DB (excluding
 * soft-deleted questions — re-importing a stem you deleted is legitimate).
 *
 * Deliberately NOT `.in("stem", …)`: stems can be long and supabase-js
 * puts .in() values in the URL, so a single long stem would 414 at the
 * gateway. Instead fetch candidate stems by target subject and compare
 * normalised in JS — the bank is small and the fetch is scoped.
 */
export async function dbDuplicateWarnings(
  validRows: readonly ValidRow[]
): Promise<ReportLine[]> {
  const subjectIds = [
    ...new Set(
      validRows
        .map((r) => r.input.subjectId)
        .filter((id) => id !== PLACEHOLDER_SUBJECT_ID)
    ),
  ];
  if (subjectIds.length === 0) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from("questions")
    .select("stem, subject_id")
    .in("subject_id", subjectIds)
    .is("deleted_at", null);

  const bySubject = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    const set = bySubject.get(row.subject_id) ?? new Set<string>();
    set.add(normalizeStem(row.stem));
    bySubject.set(row.subject_id, set);
  }

  const warnings: ReportLine[] = [];
  for (const row of validRows) {
    if (bySubject.get(row.input.subjectId)?.has(row.stemNorm)) {
      warnings.push({
        row: row.rowNumber,
        severity: "warning",
        message: `A question with this stem already exists in ${row.specialtyName} › ${row.subjectName}.`,
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

  // Only the columns admins are meant to fill in. Exam is omitted — the exam
  // is chosen on /admin/exams/[id]/import. The parser still accepts a legacy
  // Exam header (must match the forced exam). A legacy Topic column is simply
  // ignored: it's not in COLUMNS at all.
  const templateColumns = COLUMNS.filter((column) => column.inTemplate !== false);

  ws.columns = templateColumns.map((column) => ({
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
  templateColumns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.note = column.note;
    if (column.required) {
      cell.font = { bold: true, color: { argb: "FF7A1429" } };
    }
  });

  // Dropdowns for the enum columns. Assigned per-cell because exceljs's
  // shipped types don't expose worksheet.dataValidations; inline lists are
  // well under the 255-char formula limit.
  templateColumns.forEach((column, index) => {
    if (!column.dropdown) return;
    const validation = {
      type: "list" as const,
      allowBlank: true,
      formulae: [`"${column.dropdown.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Invalid value",
      error: `Use one of: ${column.dropdown.join(", ")} (or leave blank for the default).`,
    };
    for (let rowNumber = 2; rowNumber <= TEMPLATE_VALIDATION_ROWS + 1; rowNumber++) {
      ws.getCell(rowNumber, index + 1).dataValidation = validation;
    }
  });

  // Example rows — the parser recognises these exact values and skips them.
  for (const example of EXAMPLE_ROWS) {
    ws.addRow(templateColumns.map((column) => example[column.key] ?? ""));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  // writeBuffer returns a Node Buffer; copy into a standalone ArrayBuffer so
  // it satisfies BodyInit without byteOffset surprises.
  const bytes = new Uint8Array(buffer as unknown as Uint8Array);
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}
