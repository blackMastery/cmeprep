import type { Metadata } from "next";
import Link from "next/link";
import { Flag } from "lucide-react";
import {
  listLanguageStates,
  listTranslations,
  translationSpend,
} from "@/lib/admin/translations";
import {
  STALE_SCAN_LIMIT,
  translationFiltersFromSearchParams,
} from "@/lib/admin/translation-filters-core";
import { costLabel, estimateCostUsd } from "@/lib/tutor-usage-core";
import { Button } from "@/components/ui/button";
import { Pager } from "@/components/pager";
import { PageSizeSelect } from "@/components/admin/page-size-select";
import { SummaryTile } from "@/components/admin/summary-tile";
import { TranslationsTable } from "@/components/admin/translations-table";
import { TranslationFilters } from "@/components/admin/translation-filters";
import { TranslationLanguagesCard } from "@/components/admin/translation-languages-card";

export const metadata: Metadata = { title: "Translations" };

// Regenerate is a Server Action on this page and waits on the Edge Function
// for up to ~50s; the platform default would kill it mid-call, after the
// money was spent but before the audit row. Page-level maxDuration is what
// governs a page's Server Actions (Next route-segment-config docs).
export const maxDuration = 60;

export default async function AdminTranslationsPage(
  props: PageProps<"/admin/translations">
) {
  const sp = await props.searchParams;
  const filters = translationFiltersFromSearchParams(sp);

  const [result, languages, spend] = await Promise.all([
    listTranslations(filters),
    listLanguageStates(),
    translationSpend(new Date()),
  ]);
  const filtered = Boolean(
    filters.language || filters.stale || filters.search || filters.from || filters.to
  );
  const estCost =
    spend.model === null
      ? null
      : estimateCostUsd(
          spend.model,
          spend.promptTokensToday,
          spend.completionTokensToday
        );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Translations
          </h1>
          <p className="mt-1 text-muted-foreground">
            On-demand AI translations of question text. Students translate one
            question at a time; each result is cached per question and language.
          </p>
        </div>
        <Button variant="outline" size="lg" asChild>
          <Link href="/admin/questions/reports">
            <Flag data-icon="inline-start" />
            Reports
          </Link>
        </Button>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile label="Cached translations" value={String(spend.cachedTotal)} />
        <SummaryTile label="Fresh calls today" value={String(spend.freshToday)} />
        <SummaryTile
          label="Failed today"
          value={String(spend.failedToday)}
          warn={spend.failedToday > 0}
        />
        <SummaryTile
          label="Est. cost today"
          value={costLabel(estCost)}
          hint={spend.model ?? undefined}
        />
      </div>

      <div className="mb-6">
        <TranslationLanguagesCard languages={languages} />
      </div>

      <TranslationFilters
        languageCodes={languages
          .filter((l) => l.enabled || l.cached > 0)
          .map((l) => l.code)}
      />

      <div className="mt-6">
        {filters.stale && result.truncated && (
          <p className="mb-3 text-sm text-muted-foreground">
            Checked the {STALE_SCAN_LIMIT} most recent translations — narrow by
            language or date to check older ones.
          </p>
        )}
        <TranslationsTable rows={result.rows} filtered={filtered} />
      </div>

      {result.total > 0 && (
        <Pager
          page={result.page}
          pageSize={result.pageSize}
          pageCount={result.pageCount}
          total={result.total}
          shown={result.rows.length}
          params={sp}
          basePath="/admin/translations"
          sizeControl={<PageSizeSelect value={result.pageSize} />}
        />
      )}
    </div>
  );
}

