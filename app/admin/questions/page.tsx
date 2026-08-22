import type { Metadata } from "next";
import Link from "next/link";
import { Flag, Plus } from "lucide-react";
import { listQuestions, PAGE_SIZE } from "@/lib/admin/questions";
import { listHierarchy } from "@/lib/admin/taxonomy";
import { pageWindow } from "@/lib/pagination";
import { questionFiltersFromSearchParams } from "@/lib/admin/question-filters-core";
import { Button } from "@/components/ui/button";
import { QuestionsTable } from "@/components/admin/questions-table";
import { QuestionFilters } from "@/components/admin/question-filters";
import { ExportButton } from "@/components/admin/export-button";

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
          pageCount={result.pageCount}
          total={result.total}
          shown={result.rows.length}
          params={sp}
        />
      )}
    </div>
  );
}

function Pager({
  page,
  pageCount,
  total,
  shown,
  params,
}: {
  page: number;
  pageCount: number;
  total: number;
  shown: number;
  params: Record<string, string | string[] | undefined>;
}) {
  // A page beyond the end (stale link after deletes) renders an empty list;
  // navigate relative to the real last page so Previous recovers.
  const current = Math.min(page, pageCount);
  const first = (page - 1) * PAGE_SIZE + 1;

  const href = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === "page") continue;
      const value = Array.isArray(v) ? v[0] : v;
      if (value) qs.set(k, value);
    }
    if (p > 1) qs.set("page", String(p));
    const s = qs.toString();
    return s ? `/admin/questions?${s}` : "/admin/questions";
  };

  return (
    <div className="mt-6 space-y-2">
      <nav
        className="flex items-center justify-between gap-2"
        aria-label="Pagination"
      >
        <Button
          variant="outline-muted"
          size="sm"
          disabled={current <= 1}
          asChild={current > 1}
        >
          {current > 1 ? (
            <Link href={href(current - 1)}>Previous</Link>
          ) : (
            <span>Previous</span>
          )}
        </Button>

        <div className="hidden items-center gap-1 sm:flex">
          {pageWindow(current, pageCount).map((item, i) =>
            item === "gap" ? (
              <span
                key={`gap-${i}`}
                aria-hidden
                className="px-1 text-sm text-muted-foreground"
              >
                …
              </span>
            ) : (
              <Button
                key={item}
                variant={item === current ? "default" : "ghost"}
                size="sm"
                className="min-w-8 px-2 tabular-nums"
                asChild
              >
                <Link
                  href={href(item)}
                  aria-current={item === current ? "page" : undefined}
                >
                  {item}
                </Link>
              </Button>
            )
          )}
        </div>
        <span className="text-sm text-muted-foreground tabular-nums sm:hidden">
          Page {current} of {pageCount}
        </span>

        <Button
          variant="outline-muted"
          size="sm"
          disabled={current >= pageCount}
          asChild={current < pageCount}
        >
          {current < pageCount ? (
            <Link href={href(current + 1)}>Next</Link>
          ) : (
            <span>Next</span>
          )}
        </Button>
      </nav>

      {shown > 0 && (
        <p className="text-center text-xs text-muted-foreground tabular-nums">
          Showing {first}–{first + shown - 1} of {total}
        </p>
      )}
    </div>
  );
}
