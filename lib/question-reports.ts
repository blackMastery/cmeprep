import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type {
  QuestionReport,
  QuestionReportCategory,
  QuestionType,
  Test,
} from "@/lib/supabase/types";
import { withheldQuestionIds } from "@/lib/results";
import {
  canWithdraw,
  categoryRequired,
  effectiveTestStatus,
  isReportableType,
  reportCapWindowStart,
  REPORT_DAILY_CAP,
} from "@/lib/question-reports-core";

/**
 * Student side of question reports (question-reports-spec.md §2). The
 * table is service-role only, so every read here is scoped by user id by
 * hand — callers pass the verified session user, never a client value.
 */

/** A student's own open report, as the UI needs it ("You reported this"). */
export type OpenReport = {
  questionId: string;
  testId: string | null;
  category: QuestionReportCategory | null;
};

/** The user's open reports among `questionIds` — what the take/review/
 * bookmark surfaces need to render the persistent "You reported this". */
export async function openReportsFor(
  userId: string,
  questionIds: string[]
): Promise<OpenReport[]> {
  if (questionIds.length === 0) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("question_reports")
    .select("question_id, test_id, category")
    .eq("user_id", userId)
    .is("resolved_at", null)
    .in("question_id", questionIds);
  return (data ?? []).map((r) => ({
    questionId: r.question_id,
    testId: r.test_id,
    category: r.category,
  }));
}

export type FileReportResult =
  | { ok: true; status: "created" | "updated" | "duplicate" }
  | { ok: false; status: 400 | 403 | 404 | 429 | 500; error: string };

/**
 * File (or elaborate) a report. The rules, in order:
 *  - the question must be an MCQ the user has actually met: a paper of
 *    theirs (`testId`) or a bookmark/attempt — ids are not enumerable into
 *    the queue;
 *  - category is required unless the test is in progress (one silent tap);
 *  - one OPEN report per user per question: a duplicate is answered as
 *    success, and one carrying a category elaborates the bare one;
 *  - 20 a day.
 */
export async function fileQuestionReport(input: {
  userId: string;
  questionId: string;
  testId?: string;
  category?: QuestionReportCategory;
  note?: string;
}): Promise<FileReportResult> {
  const admin = createAdminClient();
  const now = new Date();

  // Independent lookups in parallel — this is the mid-exam hot path, where
  // the clock keeps running while the tap round-trips.
  const [{ data: question }, testRow, { data: existing }, { count }] =
    await Promise.all([
      admin
        .from("questions")
        .select("id, type, deleted_at, is_published")
        .eq("id", input.questionId)
        .maybeSingle(),
      input.testId
        ? admin
            .from("tests")
            .select("*")
            .eq("id", input.testId)
            .eq("user_id", input.userId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      admin
        .from("question_reports")
        .select("id, category")
        .eq("user_id", input.userId)
        .eq("question_id", input.questionId)
        .is("resolved_at", null)
        .maybeSingle(),
      admin
        .from("question_reports")
        .select("id", { count: "exact", head: true })
        .eq("user_id", input.userId)
        .gte("created_at", reportCapWindowStart(now)),
    ]);

  if (!question || question.deleted_at) {
    return { ok: false, status: 404, error: "Question not found" };
  }
  if (!isReportableType(question.type as QuestionType)) {
    return { ok: false, status: 400, error: "Not a reportable question" };
  }

  const test = (testRow.data as Test | null) ?? null;
  if (input.testId) {
    if (!test || test.mode === "osce") {
      return { ok: false, status: 404, error: "Test not found" };
    }
    const { data: link } = await admin
      .from("test_questions")
      .select("question_id")
      .eq("test_id", test.id)
      .eq("question_id", input.questionId)
      .maybeSingle();
    if (!link) {
      return { ok: false, status: 404, error: "Question is not in this test" };
    }
  } else {
    // No paper to anchor to: the question must be one they can still READ
    // (published, and not a private bank they have left — the same rule
    // results/review apply) AND one they have met via a bookmark or attempt.
    // A bookmark alone is not enough: bookmarks_insert_own only checks the
    // user id, so any known question id could be bookmarked into the queue.
    if (!question.is_published) {
      return { ok: false, status: 403, error: "You haven't met this question" };
    }
    const [withheld, { data: bookmark }, { data: attempt }] = await Promise.all([
      withheldQuestionIds(admin, [input.questionId], input.userId),
      admin
        .from("bookmarks")
        .select("question_id")
        .eq("user_id", input.userId)
        .eq("question_id", input.questionId)
        .maybeSingle(),
      admin
        .from("attempts")
        .select("id")
        .eq("user_id", input.userId)
        .eq("question_id", input.questionId)
        .limit(1)
        .maybeSingle(),
    ]);
    if (withheld.has(input.questionId) || (!bookmark && !attempt)) {
      return { ok: false, status: 403, error: "You haven't met this question" };
    }
  }

  // An expired paper nobody has finalised yet is NOT in progress for these
  // rules — the mid-test allowances end with the clock.
  const testStatus = test ? effectiveTestStatus(test, now) : null;
  if (categoryRequired(testStatus) && !input.category) {
    return { ok: false, status: 400, error: "Pick a category" };
  }

  const note = input.note && input.note.length > 0 ? input.note : null;

  // Duplicate while open: success. Only a BARE report (mid-test tap) gets
  // elaborated — an already-categorised one keeps its note; a stale tab
  // must never overwrite evidence the admin needs.
  if (existing) {
    if (input.category && existing.category === null) {
      const { error } = await admin
        .from("question_reports")
        .update({ category: input.category, note })
        .eq("id", existing.id)
        .is("category", null);
      if (error) return { ok: false, status: 500, error: "Could not report" };
      return { ok: true, status: "updated" };
    }
    return { ok: true, status: "duplicate" };
  }

  if ((count ?? 0) >= REPORT_DAILY_CAP) {
    return {
      ok: false,
      status: 429,
      error: "You've reported a lot today — try again tomorrow.",
    };
  }

  const { error } = await admin.from("question_reports").insert({
    user_id: input.userId,
    question_id: input.questionId,
    test_id: test?.id ?? null,
    category: input.category ?? null,
    note,
  });
  // 23505 = the partial unique index: a parallel tab got there first.
  if (error && error.code !== "23505") {
    return { ok: false, status: 500, error: "Could not report" };
  }
  return { ok: true, status: error ? "duplicate" : "created" };
}

/**
 * The mid-test undo. Deletes the user's open report ONLY if it was filed
 * from this still-in-progress test and never elaborated (canWithdraw);
 * otherwise it is final and the call is a no-op reported honestly.
 */
export async function withdrawQuestionReport(input: {
  userId: string;
  questionId: string;
  testId: string;
}): Promise<{ withdrawn: boolean }> {
  const admin = createAdminClient();
  const [{ data: test }, { data: report }] = await Promise.all([
    admin
      .from("tests")
      .select("id, status, expires_at")
      .eq("id", input.testId)
      .eq("user_id", input.userId)
      .maybeSingle(),
    admin
      .from("question_reports")
      .select("id, test_id, category")
      .eq("user_id", input.userId)
      .eq("question_id", input.questionId)
      .is("resolved_at", null)
      .maybeSingle(),
  ]);
  if (!test || !report) return { withdrawn: false };

  const allowed = canWithdraw({
    testStatus: effectiveTestStatus(
      test as Pick<Test, "status" | "expires_at">,
      new Date()
    ),
    reportTestId: (report as Pick<QuestionReport, "test_id">).test_id,
    testId: input.testId,
    category: report.category,
  });
  if (!allowed) return { withdrawn: false };

  const { error } = await admin
    .from("question_reports")
    .delete()
    .eq("id", report.id)
    .is("resolved_at", null);
  return { withdrawn: !error };
}
