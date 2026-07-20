import type { Metadata } from "next";
import Link from "next/link";
import { FileUp, Plus } from "lucide-react";
import { listQuestions } from "@/lib/admin/questions";
import { listTaxonomy } from "@/lib/admin/taxonomy";
import type { Difficulty, QuestionType } from "@/lib/supabase/types";
import { DIFFICULTIES, QUESTION_TYPES } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { QuestionsTable } from "@/components/admin/questions-table";
import { QuestionFilters } from "@/components/admin/question-filters";

export const metadata: Metadata = { title: "Questions" };

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : undefined;
}

export default async function AdminQuestionsPage(
  props: PageProps<"/admin/questions">
) {
  const sp = await props.searchParams;

  const difficulty = one(sp.difficulty);
  const type = one(sp.type);
  const published = one(sp.published);

  const [result, taxonomy] = await Promise.all([
    listQuestions({
      search: one(sp.q),
      subjectId: one(sp.subject),
      topicId: one(sp.topic),
      difficulty: DIFFICULTIES.includes(difficulty as Difficulty)
        ? (difficulty as Difficulty)
        : undefined,
      type: QUESTION_TYPES.includes(type as QuestionType)
        ? (type as QuestionType)
        : undefined,
      published:
        published === "true" ? true : published === "false" ? false : undefined,
      includeDeleted: one(sp.includeDeleted) === "1",
      page: Number(one(sp.page) ?? 1) || 1,
    }),
    listTaxonomy(),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Questions
          </h1>
          <p className="mt-1 text-muted-foreground">
            {result.total} question{result.total === 1 ? "" : "s"} matching.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="lg" variant="outline" asChild>
            <Link href="/admin/questions/import">
              <FileUp data-icon="inline-start" />
              Import
            </Link>
          </Button>
          <Button size="lg" asChild>
            <Link href="/admin/questions/new">
              <Plus data-icon="inline-start" />
              New question
            </Link>
          </Button>
        </div>
      </header>

      <QuestionFilters taxonomy={taxonomy} />

      <div className="mt-6">
        <QuestionsTable rows={result.rows} />
      </div>

      {result.pageCount > 1 && (
        <Pager page={result.page} pageCount={result.pageCount} params={sp} />
      )}
    </div>
  );
}

function Pager({
  page,
  pageCount,
  params,
}: {
  page: number;
  pageCount: number;
  params: Record<string, string | string[] | undefined>;
}) {
  const href = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === "page") continue;
      const value = Array.isArray(v) ? v[0] : v;
      if (value) qs.set(k, value);
    }
    qs.set("page", String(p));
    return `/admin/questions?${qs.toString()}`;
  };

  return (
    <nav className="mt-6 flex items-center justify-between" aria-label="Pagination">
      <Button variant="outline-muted" size="sm" disabled={page <= 1} asChild={page > 1}>
        {page > 1 ? <Link href={href(page - 1)}>Previous</Link> : <span>Previous</span>}
      </Button>
      <span className="text-sm text-muted-foreground tabular-nums">
        Page {page} of {pageCount}
      </span>
      <Button
        variant="outline-muted"
        size="sm"
        disabled={page >= pageCount}
        asChild={page < pageCount}
      >
        {page < pageCount ? <Link href={href(page + 1)}>Next</Link> : <span>Next</span>}
      </Button>
    </nav>
  );
}
