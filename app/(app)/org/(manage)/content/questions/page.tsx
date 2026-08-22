import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireOrgAdmin } from "@/lib/orgs";
import { listQuestions } from "@/lib/admin/questions";
import { listHierarchy } from "@/lib/admin/taxonomy";
import { pageWindow } from "@/lib/pagination";
import { questionFiltersFromSearchParams } from "@/lib/admin/question-filters-core";
import { openReportQuestionCount } from "@/lib/admin/question-reports";
import { ReportsLink } from "@/components/admin/question-reports-page";
import { Button } from "@/components/ui/button";
import { QuestionsTable } from "@/components/admin/questions-table";
import { QuestionFilters } from "@/components/admin/question-filters";
import { ExportButton } from "@/components/admin/export-button";

export const metadata: Metadata = { title: "Organisation questions" };

const BASE = "/org/content/questions";

export default async function OrgQuestionsPage(
  props: PageProps<"/org/content/questions">
) {
  const session = await requireOrgAdmin();
  const sp = await props.searchParams;

  // Every read is pinned to the org: the orgId filter walls the list, and
  // the hierarchy only offers the org's own tree to filter by.
  const [result, hierarchy, openReports] = await Promise.all([
    listQuestions({
      ...questionFiltersFromSearchParams(sp),
      orgId: session.org.id,
    }),
    listHierarchy(session.org.id),
    openReportQuestionCount({ kind: "org", orgId: session.org.id }),
  ]);

  const pages = pageWindow(result.page, result.pageCount);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {result.total} question{result.total === 1 ? "" : "s"} in your bank.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ReportsLink href="/org/content/reports" count={openReports} />
          <ExportButton total={result.total} params={sp} />
          <Button asChild>
            <Link href={`${BASE}/new`}>
            <Plus data-icon="inline-start" />
              New question
            </Link>
          </Button>
        </div>
      </div>

      <QuestionFilters hierarchy={hierarchy} basePath={BASE} />
      <QuestionsTable rows={result.rows} basePath={BASE} />

      {result.pageCount > 1 && (
        <nav aria-label="Pages" className="flex flex-wrap items-center gap-1">
          {pages.map((page, index) =>
            page === "gap" ? (
              <span key={`gap-${index}`} className="px-1 text-muted-foreground">
                …
              </span>
            ) : (
              <Button
                key={page}
                variant={page === result.page ? "default" : "ghost"}
                size="sm"
                asChild
              >
                <Link href={`${BASE}?page=${page}`}>{page}</Link>
              </Button>
            )
          )}
        </nav>
      )}
    </div>
  );
}
