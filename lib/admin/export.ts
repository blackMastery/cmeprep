import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Difficulty, QuestionType } from "@/lib/supabase/types";
import { applyQuestionFilters, QUESTION_TAXONOMY_EMBED } from "@/lib/admin/questions";
import type { QuestionListFilters } from "@/lib/admin/question-filters-core";
import {
  EXPORT_COLUMNS,
  EXPORT_PAGE_SIZE,
  EXPORT_ROW_CAP,
  EXPORT_SHEET_NAME,
  sortForExport,
  toExportRow,
  type ExportableQuestion,
} from "@/lib/admin/export-core";
import { questionImageUrl } from "@/lib/storage";

type EmbeddedRow = {
  id: string;
  type: QuestionType;
  difficulty: Difficulty;
  stem: string;
  explanation: string;
  image_path: string | null;
  created_at: string;
  subjects: {
    name: string;
    specialties: { name: string; exams: { name: string } | null } | null;
  } | null;
};

export class ExportTooLargeError extends Error {
  constructor(public readonly total: number) {
    super(
      `This export would contain ${total.toLocaleString()} questions — the limit is ${EXPORT_ROW_CAP.toLocaleString()}. Narrow the filters and try again.`
    );
  }
}

/**
 * Every question matching the filters, with live options and OSCE keys.
 *
 * Deleted rows are ALWAYS excluded, whatever the screen shows: the export is
 * the live bank, and a re-import of retired questions is never what anyone
 * wants. Pages in id order (stable across requests, unlike updated_at which
 * moves while admins edit) and sorts for humans afterwards in the core.
 */
export async function fetchQuestionsForExport(
  filters: QuestionListFilters
): Promise<ExportableQuestion[]> {
  const admin = createAdminClient();
  const effective: QuestionListFilters = { ...filters, includeDeleted: false };

  const { count, error: countError } = await applyQuestionFilters(
    admin
      .from("questions")
      .select(`id, ${QUESTION_TAXONOMY_EMBED}`, { count: "exact", head: true }),
    effective
  );
  if (countError) throw new Error(countError.message);
  const total = count ?? 0;
  if (total > EXPORT_ROW_CAP) throw new ExportTooLargeError(total);

  const rows: EmbeddedRow[] = [];
  for (let from = 0; from < total; from += EXPORT_PAGE_SIZE) {
    const { data, error } = await applyQuestionFilters(
      admin
        .from("questions")
        .select(
          "id, type, difficulty, stem, explanation, image_path, created_at, " +
            QUESTION_TAXONOMY_EMBED
        )
        .order("id")
        .range(from, from + EXPORT_PAGE_SIZE - 1),
      effective
    );
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as EmbeddedRow[];
    rows.push(...page);
    if (page.length < EXPORT_PAGE_SIZE) break;
  }

  const options = new Map<string, ExportableQuestion["options"]>();
  const modelAnswers = new Map<string, string>();
  // `.in()` goes in the URL, so keep each id list to one page's worth.
  for (let i = 0; i < rows.length; i += EXPORT_PAGE_SIZE) {
    const ids = rows.slice(i, i + EXPORT_PAGE_SIZE).map((r) => r.id);
    const [opt, ans] = await Promise.all([
      admin
        .from("question_options")
        .select("question_id, label, is_correct, position")
        .is("deleted_at", null)
        .in("question_id", ids)
        .order("position"),
      admin
        .from("question_model_answers")
        .select("question_id, model_answer")
        .in("question_id", ids),
    ]);
    if (opt.error) throw new Error(opt.error.message);
    if (ans.error) throw new Error(ans.error.message);
    for (const o of opt.data ?? []) {
      const list = options.get(o.question_id) ?? [];
      list.push({ label: o.label, is_correct: o.is_correct, position: o.position });
      options.set(o.question_id, list);
    }
    for (const a of ans.data ?? []) modelAnswers.set(a.question_id, a.model_answer);
  }

  return sortForExport(
    rows.map((r) => ({
      id: r.id,
      type: r.type,
      difficulty: r.difficulty,
      stem: r.stem,
      explanation: r.explanation,
      image_path: r.image_path,
      created_at: r.created_at,
      examName: r.subjects?.specialties?.exams?.name ?? "",
      specialtyName: r.subjects?.specialties?.name ?? "",
      subjectName: r.subjects?.name ?? "",
      options: options.get(r.id) ?? [],
      modelAnswer: modelAnswers.get(r.id) ?? null,
    }))
  );
}

/**
 * Same look as the import template (headers, notes, widths, dropdowns) minus
 * the EXAMPLE rows — there's real data here. Text format everywhere for the
 * same reason as the template: Excel must not "help" with a stem like 1/2.
 */
export async function buildExportBuffer(
  questions: ExportableQuestion[]
): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet(EXPORT_SHEET_NAME, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = EXPORT_COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
    style: {
      numFmt: "@",
      alignment: column.wrap
        ? { wrapText: true, vertical: "top" }
        : { vertical: "top" },
    },
  }));

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  EXPORT_COLUMNS.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.note = column.note;
    if (column.required) cell.font = { bold: true, color: { argb: "FFC44A18" } };
  });

  const dataRowCount = Math.max(questions.length, 1);
  EXPORT_COLUMNS.forEach((column, index) => {
    if (!column.dropdown) return;
    const validation = {
      type: "list" as const,
      allowBlank: true,
      formulae: [`"${column.dropdown.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Invalid value",
      error: `Use one of: ${column.dropdown.join(", ")} (or leave blank for the default).`,
    };
    for (let rowNumber = 2; rowNumber <= dataRowCount + 1; rowNumber++) {
      ws.getCell(rowNumber, index + 1).dataValidation = validation;
    }
  });

  for (const q of questions) {
    const row = toExportRow(q, questionImageUrl);
    ws.addRow(EXPORT_COLUMNS.map((column) => row[column.key] ?? ""));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer as unknown as Uint8Array);
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}
