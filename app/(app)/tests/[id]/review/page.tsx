import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
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
      />
    </div>
  );
}
