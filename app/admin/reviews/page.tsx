import type { Metadata } from "next";
import Link from "next/link";
import {
  isSiteReviewFilter,
  listSiteReviews,
  SITE_REVIEW_FILTERS,
  SITE_REVIEWS_PAGE_SIZE,
  type SiteReviewFilter,
} from "@/lib/admin/site-reviews";
import { reviewsArePublic } from "@/lib/site-reviews-core";
import { one, parsePage } from "@/lib/admin/question-filters-core";
import { Button } from "@/components/ui/button";
import { Pager } from "@/components/pager";
import { SiteReviewsTable } from "@/components/admin/site-reviews-table";

export const metadata: Metadata = { title: "Reviews" };

export default async function AdminReviewsPage(
  props: PageProps<"/admin/reviews">,
) {
  const sp = await props.searchParams;

  const requested = one(sp.filter);
  const filter: SiteReviewFilter = isSiteReviewFilter(requested)
    ? requested
    : "pending";

  const result = await listSiteReviews({
    filter,
    page: parsePage(one(sp.page)),
  });

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Reviews
        </h1>
        <p className="mt-1 text-muted-foreground">
          {result.pending === 0
            ? "Nothing waiting."
            : `${result.pending} waiting.`}{" "}
          {/* Publishing the first review turns the marketing band, the
              /reviews list and the rating markup on at once — and rejecting
              the last one takes them all down again. Worth saying out loud. */}
          {reviewsArePublic(result.approved)
            ? `${result.approved} published and live on the site.`
            : "Nothing published yet — the site shows reviews as soon as one is."}
        </p>
      </header>

      <nav
        className="mb-6 flex flex-wrap items-center gap-1"
        aria-label="Filter"
      >
        {SITE_REVIEW_FILTERS.map((f) => (
          <Button
            key={f.value}
            variant={f.value === filter ? "default" : "ghost"}
            size="sm"
            asChild
          >
            <Link
              href={
                f.value === "pending"
                  ? "/admin/reviews"
                  : `/admin/reviews?filter=${f.value}`
              }
              aria-current={f.value === filter ? "page" : undefined}
            >
              {f.label}
            </Link>
          </Button>
        ))}
      </nav>

      <SiteReviewsTable rows={result.rows} />

      {result.pageCount > 1 && (
        <Pager
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          shown={result.rows.length}
          pageSize={SITE_REVIEWS_PAGE_SIZE}
          basePath="/admin/reviews"
          params={sp}
        />
      )}
    </div>
  );
}
