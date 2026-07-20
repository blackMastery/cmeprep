import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { finalizeIfExpired, getTestForUser } from "@/lib/tests";
import { getTestResults } from "@/lib/results";
import { Button } from "@/components/ui/button";
import { ReviewList } from "@/components/test/review-list";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage(
  props: PageProps<"/tests/[id]/review">
) {
  const { id } = await props.params;
  const { filter } = await props.searchParams;
  const user = await requireUser();

  const existing = await getTestForUser(id, user.id);
  if (!existing) notFound();

  // Correct answers and explanations are only ever served for a finished test.
  const test = await finalizeIfExpired(existing, user.id);
  if (test.status === "in_progress") {
    redirect(`/tests/${id}/take`);
  }

  const results = await getTestResults(test, user.id);

  // The learner's own bookmarks + notes for these questions (RLS-scoped).
  const questionIds = results.questions.map((q) => q.questionId);
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

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/tests/${id}/results`}>
            <ArrowLeft data-icon="inline-start" />
            Results
          </Link>
        </Button>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Review
        </h1>
      </div>

      <ReviewList
        questions={results.questions}
        initialWrongOnly={filter === "wrong"}
        initialBookmarkedIds={(bookmarkRows ?? []).map((b) => b.question_id)}
        notesByQuestion={notesByQuestion}
      />
    </div>
  );
}
