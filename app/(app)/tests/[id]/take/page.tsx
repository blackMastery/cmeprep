import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { finalizeIfExpired, getTakeState, getTestForUser } from "@/lib/tests";
import { openReportsFor } from "@/lib/question-reports";
import { listEnabledLanguageCodes } from "@/lib/translations";
import { resolveTranslationLanguage } from "@/lib/translation-core";
import { TestRunner } from "@/components/test/test-runner";
import { TutorRunner } from "@/components/test/tutor-runner";
import { OsceRunner } from "@/components/test/osce-runner";

export const metadata: Metadata = { title: "Test in progress" };

export default async function TakeTestPage(
  props: PageProps<"/tests/[id]/take">
) {
  const { id } = await props.params;
  const user = await requireUser();

  const existing = await getTestForUser(id, user.id);
  if (!existing) notFound();

  // If the deadline passed while the user was away, score it now and send
  // them to results instead of handing back a live-looking test. (No-op for
  // tutor sessions — they have no deadline.)
  const test = await finalizeIfExpired(existing, user.id);
  if (test.status !== "in_progress") {
    redirect(`/tests/${id}/results`);
  }

  const state = await getTakeState(id, user.id);
  if (!state) notFound();

  const questionIds = state.questions.map((q) => q.questionId);

  // Translate: the one resolver — the paper's frozen language wins, a
  // still-enabled profile default seeds the first click, a disabled default
  // means the picker. A paper frozen to a since-disabled language offers no
  // new translations (its cached ones stay toggleable).
  const enabledLanguageCodes = await listEnabledLanguageCodes();
  const { language: initialLanguage, refused } = resolveTranslationLanguage({
    testLanguage: state.test.language,
    requested: undefined,
    profileDefault: user.profile.preferred_language,
    enabled: enabledLanguageCodes,
  });
  const translationProps = {
    enabledLanguageCodes: refused ? [] : enabledLanguageCodes,
    initialLanguage,
  };

  // "You reported this" persists wherever the student meets the question —
  // and mid-test the tap toggles, so the runner needs what's open (with
  // test id + category, to know which it may undo). OSCE stations keep
  // "Report this grade" and get no second control.
  if (state.test.mode === "exam") {
    const reports = await openReportsFor(user.id, questionIds);
    return (
      <TestRunner
        state={state}
        initialReports={reports}
        {...translationProps}
      />
    );
  }

  // Tutor and OSCE sessions surface bookmark + note editing at reveal time,
  // so the runner needs the learner's existing rows up front (RLS-scoped,
  // same pattern as the review page).
  const idFilter = questionIds.length > 0 ? questionIds : [""];
  const supabase = await createClient();
  const [{ data: bookmarkRows }, { data: noteRows }, reports] = await Promise.all([
    supabase
      .from("bookmarks")
      .select("question_id")
      .eq("user_id", user.id)
      .in("question_id", idFilter),
    supabase
      .from("notes")
      .select("question_id, body")
      .eq("user_id", user.id)
      .in("question_id", idFilter),
    state.test.mode === "osce"
      ? Promise.resolve([])
      : openReportsFor(user.id, questionIds),
  ]);

  const notesByQuestion: Record<string, string> = {};
  for (const n of noteRows ?? []) notesByQuestion[n.question_id] = n.body;

  const runnerProps = {
    state,
    initialBookmarkedIds: (bookmarkRows ?? []).map((b) => b.question_id),
    notesByQuestion,
    ...translationProps,
  };

  return state.test.mode === "osce" ? (
    <OsceRunner {...runnerProps} />
  ) : (
    <TutorRunner
      {...runnerProps}
      initialReportedIds={reports.map((r) => r.questionId)}
    />
  );
}
