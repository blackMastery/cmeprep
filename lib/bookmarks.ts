import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QuestionType } from "@/lib/supabase/types";

export const BOOKMARKS_PAGE_SIZE = 20;

export type BookmarkDetailOption = {
  id: string;
  label: string;
  isCorrect: boolean;
};

export type BookmarkRow = {
  questionId: string;
  bookmarkedAt: string;
  /** Question got unpublished or soft-deleted after bookmarking. */
  unavailable: boolean;
  stem: string;
  type: QuestionType;
  imagePath: string | null;
  subjectName: string;
  topicName: string;
  note: string | null;
  lastAttempt: {
    answeredAt: string;
    isCorrect: boolean;
    selectedOptionIds: string[];
  } | null;
  /**
   * Options (with correctness) + explanation — present ONLY when the user has
   * an attempts row for the question. Same justification as the review page
   * (lib/results.ts): answers are served once the learner has genuinely
   * attempted the question, never before.
   */
  detail: {
    options: BookmarkDetailOption[];
    explanation: string;
  } | null;
};

export type BookmarksPage = {
  rows: BookmarkRow[];
  total: number;
  page: number;
  pageCount: number;
};

/**
 * PostgREST resolves the FK embed at runtime; the hand-maintained Database
 * type has no relationship metadata, so the embedded row is typed by hand
 * and cast — same idiom as lib/admin/questions.ts.
 */
type EmbeddedBookmark = {
  question_id: string;
  created_at: string;
  questions: {
    id: string;
    stem: string;
    type: QuestionType;
    image_path: string | null;
    explanation: string;
    topics: { name: string; subjects: { name: string } | null } | null;
  } | null;
};

export async function getBookmarksPage(
  userId: string,
  page: number
): Promise<BookmarksPage> {
  const supabase = await createClient();
  const safePage = Math.max(1, page);
  const from = (safePage - 1) * BOOKMARKS_PAGE_SIZE;

  // RLS'd: bookmarks are own-row; the questions embed comes back null for
  // anything the learner may no longer see (unpublished / soft-deleted).
  const { data, count } = await supabase
    .from("bookmarks")
    .select(
      "question_id, created_at, questions(id, stem, type, image_path, explanation, topics(name, subjects(name)))",
      { count: "exact" }
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(from, from + BOOKMARKS_PAGE_SIZE - 1);

  const bookmarks = (data ?? []) as unknown as EmbeddedBookmark[];
  const questionIds = bookmarks.map((b) => b.question_id);
  const total = count ?? 0;

  if (questionIds.length === 0) {
    return {
      rows: [],
      total,
      page: safePage,
      pageCount: Math.max(1, Math.ceil(total / BOOKMARKS_PAGE_SIZE)),
    };
  }

  const [{ data: notes }, { data: attempts }] = await Promise.all([
    supabase
      .from("notes")
      .select("question_id, body")
      .eq("user_id", userId)
      .in("question_id", questionIds),
    supabase
      .from("attempts")
      .select("question_id, selected_option_ids, is_correct, answered_at")
      .eq("user_id", userId)
      .in("question_id", questionIds)
      .order("answered_at", { ascending: false }),
  ]);

  const noteByQuestion = new Map<string, string>();
  for (const n of notes ?? []) noteByQuestion.set(n.question_id, n.body);

  // Rows are newest-first; keep the first (latest) attempt per question.
  const latestAttempt = new Map<
    string,
    { answeredAt: string; isCorrect: boolean; selectedOptionIds: string[] }
  >();
  for (const a of attempts ?? []) {
    if (!latestAttempt.has(a.question_id)) {
      latestAttempt.set(a.question_id, {
        answeredAt: a.answered_at,
        isCorrect: a.is_correct,
        selectedOptionIds: (a.selected_option_ids ?? []) as string[],
      });
    }
  }

  // Correctness is service-role-only (is_correct is revoked from clients).
  // Fetch it strictly for questions this user has attempted — the same gate
  // the review page applies.
  const attemptedIds = questionIds.filter((id) => latestAttempt.has(id));
  const optionsByQuestion = new Map<string, BookmarkDetailOption[]>();
  if (attemptedIds.length > 0) {
    const admin = createAdminClient();
    const { data: options } = await admin
      .from("question_options")
      .select("id, question_id, label, is_correct, position")
      .in("question_id", attemptedIds)
      .is("deleted_at", null)
      .order("position", { ascending: true });

    for (const opt of options ?? []) {
      const list = optionsByQuestion.get(opt.question_id) ?? [];
      // Live options in editorial order — outside a test there is no frozen
      // option_order to honour.
      list.push({ id: opt.id, label: opt.label, isCorrect: opt.is_correct });
      optionsByQuestion.set(opt.question_id, list);
    }
  }

  const rows: BookmarkRow[] = bookmarks.map((b) => {
    const q = b.questions;
    const attempt = latestAttempt.get(b.question_id) ?? null;
    const options = optionsByQuestion.get(b.question_id);

    return {
      questionId: b.question_id,
      bookmarkedAt: b.created_at,
      unavailable: q === null,
      stem: q?.stem ?? "",
      type: q?.type ?? "mcq_single",
      imagePath: q?.image_path ?? null,
      subjectName: q?.topics?.subjects?.name ?? "",
      topicName: q?.topics?.name ?? "",
      note: noteByQuestion.get(b.question_id) ?? null,
      lastAttempt: attempt,
      detail:
        q && attempt && options && options.length > 0
          ? { options, explanation: q.explanation }
          : null,
    };
  });

  return {
    rows,
    total,
    page: safePage,
    pageCount: Math.max(1, Math.ceil(total / BOOKMARKS_PAGE_SIZE)),
  };
}
