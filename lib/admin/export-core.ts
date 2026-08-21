import { COLUMNS, OPTION_LETTERS, type ColumnDef } from "@/lib/admin/import-core";
import type { Difficulty, QuestionType } from "@/lib/supabase/types";

/**
 * Pure half of the question export: one DB row in, one template-shaped sheet
 * row out. The route/workbook writer (lib/admin/export.ts) stays thin so every
 * lossy or surprising mapping is covered by vitest.
 *
 * The export deliberately mirrors the IMPORT template (same COLUMNS module)
 * so a downloaded sheet can be edited and fed back through the importer —
 * modulo IMPORT_ROW_CAP, which is the admin's problem to split around.
 */

/**
 * Hard ceiling on rows per export. The route pages the DB in
 * EXPORT_PAGE_SIZE chunks and builds the workbook in memory; 50k rows × ~17
 * text columns is tens of MB of RAM and well inside a 300s `maxDuration`.
 * Past this the admin is told to narrow the filters rather than left to a
 * silent timeout. Raise alongside the route's maxDuration.
 */
export const EXPORT_ROW_CAP = 50_000;

/** Supabase/PostgREST serves at most 1,000 rows per request by default. */
export const EXPORT_PAGE_SIZE = 1_000;

export const EXPORT_SHEET_NAME = "Questions";

/** What the server hands the mapper — joined taxonomy names, live options, OSCE key. */
export type ExportableQuestion = {
  id: string;
  type: QuestionType;
  difficulty: Difficulty;
  stem: string;
  explanation: string;
  image_path: string | null;
  created_at: string;
  examName: string;
  specialtyName: string;
  subjectName: string;
  /** Live (non-deleted) options in position order. */
  options: { label: string; is_correct: boolean; position: number }[];
  modelAnswer: string | null;
};

/**
 * Extra columns the importer does not know about. They sit AFTER every
 * template column so an exported sheet still parses: the parser matches
 * headers by name and ignores unknown ones.
 */
export const EXPORT_EXTRA_COLUMNS: readonly ColumnDef[] = [
  {
    key: "questionId",
    header: "Question ID",
    required: false,
    note: "Export only. The question's id in cmeprep — ignored on import.",
    width: 38,
  },
  {
    key: "exportNotes",
    header: "Export notes",
    required: false,
    note: "Export only. Anything the sheet could not represent faithfully (e.g. options beyond H dropped).",
    width: 40,
    wrap: true,
  },
];

/**
 * Every template column — Exam included. The blank template omits Exam
 * because the importer pins the exam from the URL, but an export can span
 * exams, and the parser still accepts the legacy header.
 */
export const EXPORT_COLUMNS: readonly ColumnDef[] = [
  ...COLUMNS,
  ...EXPORT_EXTRA_COLUMNS,
];

/**
 * Template type values. `image_based` is a legacy type the parser rejects
 * ("image is a property, not a type"), so it exports as single/multi by the
 * number of correct options, with the picture riding the Image column.
 */
export function exportTypeValue(
  type: QuestionType,
  correctCount: number
): "single" | "multi" | "osce" {
  if (type === "osce") return "osce";
  if (type === "mcq_multi") return "multi";
  if (type === "mcq_single") return "single";
  return correctCount > 1 ? "multi" : "single";
}

export type ExportRow = Record<string, string>;

export function toExportRow(
  q: ExportableQuestion,
  imageUrl: (path: string | null) => string | null
): ExportRow {
  const notes: string[] = [];
  const options = [...q.options].sort((a, b) => a.position - b.position);
  const kept = options.slice(0, OPTION_LETTERS.length);
  if (options.length > OPTION_LETTERS.length) {
    notes.push(
      `${options.length} options; ${options.length - OPTION_LETTERS.length} beyond ${OPTION_LETTERS[OPTION_LETTERS.length - 1]} dropped.`
    );
  }
  const correctLetters = kept
    .map((o, i) => (o.is_correct ? OPTION_LETTERS[i] : null))
    .filter((l): l is (typeof OPTION_LETTERS)[number] => l !== null);
  const droppedCorrect = options
    .slice(OPTION_LETTERS.length)
    .filter((o) => o.is_correct).length;
  if (droppedCorrect > 0) {
    notes.push(`${droppedCorrect} dropped option(s) were marked correct.`);
  }

  const row: ExportRow = {
    exam: q.examName,
    specialty: q.specialtyName,
    subject: q.subjectName,
    type: exportTypeValue(q.type, correctLetters.length + droppedCorrect),
    difficulty: q.difficulty,
    stem: q.stem,
    explanation: q.explanation,
    modelAnswer: q.type === "osce" ? (q.modelAnswer ?? "") : "",
    correct: q.type === "osce" ? "" : correctLetters.join(","),
    image: imageUrl(q.image_path) ?? "",
    questionId: q.id,
    exportNotes: "",
  };
  if (q.type === "osce" && !q.modelAnswer) {
    notes.push("OSCE question has no model answer on file.");
  }
  for (let i = 0; i < OPTION_LETTERS.length; i++) {
    row[`option${OPTION_LETTERS[i]}`] = kept[i]?.label ?? "";
  }
  row.exportNotes = notes.join(" ");
  return row;
}

/** Exam → Specialty → Subject → created_at, then id for determinism. */
export function sortForExport<T extends ExportableQuestion>(rows: T[]): T[] {
  const cmp = (a: string, b: string) =>
    a.localeCompare(b, "en", { sensitivity: "base" });
  return [...rows].sort(
    (a, b) =>
      cmp(a.examName, b.examName) ||
      cmp(a.specialtyName, b.specialtyName) ||
      cmp(a.subjectName, b.subjectName) ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id)
  );
}

/** questions-export-<exam-slug|all-exams>-<YYYY-MM-DD>.xlsx */
export function exportFilename(examName: string | null, date: Date): string {
  const slug =
    examName
      ?.toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "all-exams";
  return `questions-export-${slug}-${date.toISOString().slice(0, 10)}.xlsx`;
}
