import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Difficulty,
  Question,
  QuestionOption,
  QuestionType,
} from "@/lib/supabase/types";
import type { ExistingOption } from "@/lib/admin/option-diff";
import {
  DEFAULT_PAGE_SIZE,
  type QuestionListFilters,
} from "@/lib/admin/question-filters-core";

export type { QuestionListFilters };

/** The embed path every list/export read walks — filters and the org wall hang off it. */
export const QUESTION_TAXONOMY_EMBED =
  "subjects!inner(id, name, specialty_id, specialties!inner(id, name, exam_id, exams!inner(id, name)))";

type FilterableQuery = {
  is(column: string, value: null): FilterableQuery;
  eq(column: string, value: unknown): FilterableQuery;
  textSearch(
    column: string,
    query: string,
    options: { type: "websearch"; config: string }
  ): FilterableQuery;
};

/**
 * Apply the list filters to a `questions` query that selects
 * QUESTION_TAXONOMY_EMBED. Shared by the paged list and the export so the
 * two can never disagree about which rows "match".
 */
export function applyQuestionFilters<Q extends FilterableQuery>(
  query: Q,
  filters: QuestionListFilters
): Q {
  let q: FilterableQuery = query;
  if (!filters.includeDeleted) q = q.is("deleted_at", null);
  // The org wall rides the same !inner joins the level filters use.
  if (filters.orgId)
    q = q.eq("subjects.specialties.exams.org_id", filters.orgId);
  // Most-specific level wins; the !inner joins above make parent filters work.
  if (filters.subjectId) q = q.eq("subject_id", filters.subjectId);
  else if (filters.specialtyId)
    q = q.eq("subjects.specialty_id", filters.specialtyId);
  else if (filters.examId)
    q = q.eq("subjects.specialties.exam_id", filters.examId);
  if (filters.difficulty) q = q.eq("difficulty", filters.difficulty);
  if (filters.type) q = q.eq("type", filters.type);
  if (filters.published !== undefined)
    q = q.eq("is_published", filters.published);
  if (filters.search) {
    // websearch_to_tsquery never throws on free text; to_tsquery (the default)
    // 400s on anything with a space. `english` must match the generated column.
    q = q.textSearch("search_vec", filters.search, {
      type: "websearch",
      config: "english",
    });
  }
  return q as Q;
}

export type QuestionListRow = {
  id: string;
  stem: string;
  type: QuestionType;
  difficulty: Difficulty;
  is_published: boolean;
  deleted_at: string | null;
  updated_at: string | null;
  examName: string;
  subjectName: string;
  specialtyName: string;
  optionCount: number;
  correctCount: number;
  /** Non-zero means editing the answer key rewrites history. */
  usageCount: number;
};

// Hand-typed because `Relationships: []` in the Database type stops PostgREST
// embeds from inferring — same workaround as lib/tests.ts.
type EmbeddedRow = {
  id: string;
  stem: string;
  type: QuestionType;
  difficulty: Difficulty;
  is_published: boolean;
  deleted_at: string | null;
  updated_at: string | null;
  subject_id: string;
  subjects: {
    id: string;
    name: string;
    specialty_id: string;
    specialties: {
      id: string;
      name: string;
      exam_id: string;
      exams: { id: string; name: string } | null;
    } | null;
  } | null;
};

export async function listQuestions(filters: QuestionListFilters): Promise<{
  rows: QuestionListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}> {
  const admin = createAdminClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;

  const query = applyQuestionFilters(
    admin
      .from("questions")
      .select(
        "id, stem, type, difficulty, is_published, deleted_at, updated_at, subject_id, " +
          QUESTION_TAXONOMY_EMBED,
        { count: "exact" }
      )
      .order("updated_at", { ascending: false, nullsFirst: false })
      .range(from, from + pageSize - 1),
    filters
  );

  const { data, count } = await query;
  const rows = (data ?? []) as unknown as EmbeddedRow[];
  const ids = rows.map((r) => r.id);

  const [{ data: options }, { data: usage }] = await Promise.all([
    ids.length
      ? admin
          .from("question_options")
          .select("question_id, is_correct")
          .is("deleted_at", null)
          .in("question_id", ids)
      : Promise.resolve({ data: [] as { question_id: string; is_correct: boolean }[] }),
    ids.length
      ? admin.from("test_questions").select("question_id").in("question_id", ids)
      : Promise.resolve({ data: [] as { question_id: string }[] }),
  ]);

  const optionCount = new Map<string, number>();
  const correctCount = new Map<string, number>();
  for (const o of options ?? []) {
    optionCount.set(o.question_id, (optionCount.get(o.question_id) ?? 0) + 1);
    if (o.is_correct) {
      correctCount.set(o.question_id, (correctCount.get(o.question_id) ?? 0) + 1);
    }
  }

  const usageCount = new Map<string, number>();
  for (const u of usage ?? []) {
    usageCount.set(u.question_id, (usageCount.get(u.question_id) ?? 0) + 1);
  }

  const total = count ?? 0;

  return {
    rows: rows.map((r) => ({
      id: r.id,
      stem: r.stem,
      type: r.type,
      difficulty: r.difficulty,
      is_published: r.is_published,
      deleted_at: r.deleted_at,
      updated_at: r.updated_at,
      examName: r.subjects?.specialties?.exams?.name ?? "",
      subjectName: r.subjects?.name ?? "",
      specialtyName: r.subjects?.specialties?.name ?? "",
      optionCount: optionCount.get(r.id) ?? 0,
      correctCount: correctCount.get(r.id) ?? 0,
      usageCount: usageCount.get(r.id) ?? 0,
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export type QuestionForEdit = {
  question: Question;
  options: ExistingOption[];
  /** Live options only — retired ones stay in the DB but leave the editor. */
  visibleOptions: ExistingOption[];
  /** OSCE answer key (question_model_answers); null for MCQ types. */
  modelAnswer: string | null;
  usageCount: number;
};

export async function getQuestionForEdit(
  id: string
): Promise<QuestionForEdit | null> {
  const admin = createAdminClient();

  const { data: question } = await admin
    .from("questions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!question) return null;

  const [{ data: options }, { count }, { data: modelAnswerRow }] =
    await Promise.all([
      admin
        .from("question_options")
        .select("*")
        .eq("question_id", id)
        .order("position"),
      admin
        .from("test_questions")
        .select("question_id", { count: "exact", head: true })
        .eq("question_id", id),
      admin
        .from("question_model_answers")
        .select("model_answer")
        .eq("question_id", id)
        .maybeSingle(),
    ]);

  const all = ((options ?? []) as QuestionOption[]).map((o) => ({
    id: o.id,
    label: o.label,
    is_correct: o.is_correct,
    position: o.position,
    deleted_at: o.deleted_at,
  }));

  return {
    question: question as Question,
    options: all,
    visibleOptions: all.filter((o) => !o.deleted_at),
    modelAnswer: modelAnswerRow?.model_answer ?? null,
    usageCount: count ?? 0,
  };
}

export async function contentCounts() {
  const admin = createAdminClient();

  const [users, plans, exams, specialties, subjects, published, drafts] =
    await Promise.all([
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin.from("plans").select("id", { count: "exact", head: true }),
      admin.from("exams").select("id", { count: "exact", head: true }),
      admin.from("specialties").select("id", { count: "exact", head: true }),
      admin.from("subjects").select("id", { count: "exact", head: true }),
      admin
        .from("questions")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .eq("is_published", true),
      admin
        .from("questions")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .eq("is_published", false),
    ]);

  return {
    users: users.count ?? 0,
    plans: plans.count ?? 0,
    exams: exams.count ?? 0,
    specialties: specialties.count ?? 0,
    subjects: subjects.count ?? 0,
    published: published.count ?? 0,
    drafts: drafts.count ?? 0,
  };
}
