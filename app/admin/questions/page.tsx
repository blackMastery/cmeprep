import type { Metadata } from "next";
import Link from "next/link";
import { Flag, Plus } from "lucide-react";
import { listQuestions } from "@/lib/admin/questions";
import { listHierarchy } from "@/lib/admin/taxonomy";
import { questionFiltersFromSearchParams } from "@/lib/admin/question-filters-core";
import { Button } from "@/components/ui/button";
import { QuestionsTable } from "@/components/admin/questions-table";
import { QuestionFilters } from "@/components/admin/question-filters";
import { ExportButton } from "@/components/admin/export-button";
import { Pager } from "@/components/pager";
import { PageSizeSelect } from "@/components/admin/page-size-select";

export const metadata: Metadata = { title: "Questions" };

export default async function AdminQuestionsPage(
  props: PageProps<"/admin/questions">
) {
  const sp = await props.searchParams;

  const [result, hierarchy] = await Promise.all([
    listQuestions(questionFiltersFromSearchParams(sp)),
    listHierarchy(),
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
          <Button variant="outline" size="lg" asChild>
            <Link href="/admin/questions/reports">
              <Flag data-icon="inline-start" />
              Reports
            </Link>
          </Button>
          <ExportButton total={result.total} params={sp} />
          <Button size="lg" asChild>
            <Link href="/admin/questions/new">
              <Plus data-icon="inline-start" />
              New question
            </Link>
          </Button>
        </div>
      </header>

      <QuestionFilters hierarchy={hierarchy} />

      <div className="mt-6">
        <QuestionsTable rows={result.rows} />
      </div>

      {result.total > 0 && (
        <Pager
          page={result.page}
          pageSize={result.pageSize}
          pageCount={result.pageCount}
          total={result.total}
          shown={result.rows.length}
          params={sp}
          basePath="/admin/questions"
          sizeControl={<PageSizeSelect value={result.pageSize} />}
        />
      )}
    </div>
  );
}

