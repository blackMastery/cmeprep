import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { finalizeIfExpired, getTakeState, getTestForUser } from "@/lib/tests";
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

  if (state.test.mode === "exam") {
    return <TestRunner state={state} />;
  }

  // Tutor and OSCE sessions surface bookmark + note editing at reveal time,
  // so the runner needs the learner's existing rows up front (RLS-scoped,
  // same pattern as the review page).
  const questionIds = state.questions.map((q) => q.questionId);
  const idFilter = questionIds.length > 0 ? questionIds : [""];
  const supabase = await createClient();
  const [{ data: bookmarkRows }, { data: noteRows }] = await Promise.all([
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
  ]);

  const notesByQuestion: Record<string, string> = {};
  for (const n of noteRows ?? []) notesByQuestion[n.question_id] = n.body;

  const runnerProps = {
    state,
    initialBookmarkedIds: (bookmarkRows ?? []).map((b) => b.question_id),
    notesByQuestion,
  };

  return state.test.mode === "osce" ? (
    <OsceRunner {...runnerProps} />
  ) : (
    <TutorRunner {...runnerProps} />
  );
}
