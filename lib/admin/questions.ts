import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Difficulty,
  Question,
  QuestionOption,
  QuestionType,
} from "@/lib/supabase/types";
import type { ExistingOption } from "@/lib/admin/option-diff";

export const PAGE_SIZE = 20;

export type QuestionListFilters = {
  search?: string;
  examId?: string;
  specialtyId?: string;
  subjectId?: string;
  topicId?: string;
  difficulty?: Difficulty;
  type?: QuestionType;
  published?: boolean;
  includeDeleted?: boolean;
  page?: number;
};

export type QuestionListRow = {
  id: string;
  stem: string;
  type: QuestionType;
  difficulty: Difficulty;
  is_published: boolean;
  deleted_at: string | null;
  updated_at: string | null;
  topicName: string;
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
  topic_id: string;
  topics: {
    id: string;
    name: string;
    subject_id: string;
    subjects: {
      id: string;
      name: string;
      specialty_id: string;
      specialties: { id: string; name: string; exam_id: string } | null;
    } | null;
  } | null;
};

export async function listQuestions(filters: QuestionListFilters): Promise<{
  rows: QuestionListRow[];
  total: number;
  page: number;
  pageCount: number;
}> {
  const admin = createAdminClient();
  const page = Math.max(1, filters.page ?? 1);
  const from = (page - 1) * PAGE_SIZE;

  let query = admin
    .from("questions")
    .select(
      "id, stem, type, difficulty, is_published, deleted_at, updated_at, topic_id, " +
        "topics!inner(id, name, subject_id, subjects!inner(id, name, specialty_id, " +
        "specialties!inner(id, name, exam_id)))",
      { count: "exact" }
    )
    .order("updated_at", { ascending: false, nullsFirst: false })
    .range(from, from + PAGE_SIZE - 1);

  if (!filters.includeDeleted) query = query.is("deleted_at", null);
  // Most-specific level wins; the !inner joins above make parent filters work.
  if (filters.topicId) query = query.eq("topic_id", filters.topicId);
  else if (filters.subjectId)
    query = query.eq("topics.subject_id", filters.subjectId);
  else if (filters.specialtyId)
    query = query.eq("topics.subjects.specialty_id", filters.specialtyId);
  else if (filters.examId)
    query = query.eq("topics.subjects.specialties.exam_id", filters.examId);
  if (filters.difficulty) query = query.eq("difficulty", filters.difficulty);
  if (filters.type) query = query.eq("type", filters.type);
  if (filters.published !== undefined)
    query = query.eq("is_published", filters.published);
  if (filters.search) {
    // websearch_to_tsquery never throws on free text; to_tsquery (the default)
    // 400s on anything with a space. `english` must match the generated column.
    query = query.textSearch("search_vec", filters.search, {
      type: "websearch",
      config: "english",
    });
  }

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
      topicName: r.topics?.name ?? "",
      subjectName: r.topics?.subjects?.name ?? "",
      specialtyName: r.topics?.subjects?.specialties?.name ?? "",
      optionCount: optionCount.get(r.id) ?? 0,
      correctCount: correctCount.get(r.id) ?? 0,
      usageCount: usageCount.get(r.id) ?? 0,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export type QuestionForEdit = {
  question: Question;
  options: ExistingOption[];
  /** Live options only — retired ones stay in the DB but leave the editor. */
  visibleOptions: ExistingOption[];
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

  const [{ data: options }, { count }] = await Promise.all([
    admin
      .from("question_options")
      .select("*")
      .eq("question_id", id)
      .order("position"),
    admin
      .from("test_questions")
      .select("question_id", { count: "exact", head: true })
      .eq("question_id", id),
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
    usageCount: count ?? 0,
  };
}

export async function contentCounts() {
  const admin = createAdminClient();

  const [users, plans, exams, specialties, subjects, topics, published, drafts] =
    await Promise.all([
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin.from("plans").select("id", { count: "exact", head: true }),
      admin.from("exams").select("id", { count: "exact", head: true }),
      admin.from("specialties").select("id", { count: "exact", head: true }),
      admin.from("subjects").select("id", { count: "exact", head: true }),
      admin.from("topics").select("id", { count: "exact", head: true }),
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
    topics: topics.count ?? 0,
    published: published.count ?? 0,
    drafts: drafts.count ?? 0,
  };
}
