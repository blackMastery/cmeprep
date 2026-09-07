import type { Metadata } from "next";
import Link from "next/link";
import { OG_IMAGE, SITE_NAME, TWITTER_IMAGE } from "@/lib/site";
import { getApprovedReviewsPage } from "@/lib/site-reviews";
import { REVIEWS_PAGE_SIZE, reviewsArePublic } from "@/lib/site-reviews-core";
import { one, parsePage } from "@/lib/admin/question-filters-core";
import { listEnabledLanguageCodes } from "@/lib/translations";
import { languageByCode } from "@/lib/translation-core";
import { Button } from "@/components/ui/button";
import { Pager } from "@/components/pager";
import { ReviewCard } from "@/components/marketing/review-card";
import { ReviewSummary } from "@/components/marketing/review-summary";
import { ReviewsStructuredData } from "@/components/marketing/reviews-structured-data";

/**
 * The first explicit `dynamic` in app/(marketing) — and it needs to be.
 *
 * The other marketing pages are per-request dynamic by accident: they read
 * cookies (listActivePlans -> lib/supabase/server -> cookies()). This one
 * reads only through the service-role client, so Next would otherwise
 * prerender it at build time, where SUPABASE_ADMIN_SECRET_KEY does not exist
 * and the build fails.
 *
 * It would have to be dynamic regardless: the visible average and the
 * aggregateRating markup have to come from the same live read, and a cached
 * aggregate is exactly how markup and content start disagreeing.
 */
export const dynamic = "force-dynamic";

const REVIEWS_TITLE = "Reviews";
const REVIEWS_DESCRIPTION = `What doctors and students say about ${SITE_NAME} — reviews from people who used the question bank, timed mock exams and AI tutor to prepare for their board and exit examinations.`;

/**
 * Static metadata, not generateMetadata: putting the live average in the
 * description would cost a second query per request purely for a <meta> tag,
 * and it could drift from the body between two awaits. The canonical is the
 * bare /reviews on every page, so crawlers are pointed at page 1.
 */
export const metadata: Metadata = {
  title: REVIEWS_TITLE,
  description: REVIEWS_DESCRIPTION,
  alternates: { canonical: "/reviews" },
  // `images` is repeated deliberately — declaring openGraph/twitter at page
  // level replaces the root's instead of merging. See lib/site.ts.
  openGraph: {
    url: "/reviews",
    title: `${REVIEWS_TITLE} · ${SITE_NAME}`,
    description: REVIEWS_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    title: `${REVIEWS_TITLE} · ${SITE_NAME}`,
    description: REVIEWS_DESCRIPTION,
    images: [TWITTER_IMAGE],
  },
};

export default async function ReviewsPage(props: PageProps<"/reviews">) {
  const sp = await props.searchParams;
  // parsePage, not a hand-rolled Number(): ?page=2.3 and ?page=1e999 both
  // produce a malformed PostgREST range whose error is swallowed into an
  // empty list under a live-looking summary.
  const page = parsePage(one(sp.page));

  const [result, enabledLanguageCodes] = await Promise.all([
    getApprovedReviewsPage(page, REVIEWS_PAGE_SIZE),
    listEnabledLanguageCodes(),
  ]);
  const { rows, summary } = result;
  const live = reviewsArePublic(summary.count);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:py-16">
      {/* Fed from the SAME awaited object as the visible summary below, so
          the markup and the page can never disagree. */}
      <ReviewsStructuredData
        reviews={rows}
        total={summary.count}
        averageLabel={summary.averageLabel}
        page={result.page}
        languages={enabledLanguageCodes.flatMap((code) => {
          const l = languageByCode(code);
          return l ? [{ code, name: l.name }] : [];
        })}
      />

      <header className="mb-8">
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Reviews
        </h1>

        {live && summary.averageLabel !== null ? (
          <ReviewSummary
            averageLabel={summary.averageLabel}
            total={summary.count}
            variant="page"
            className="mt-4"
          />
        ) : (
          // Deliberately a 200, not a 404: this URL is in the sitemap, and a
          // route that flips 404 -> 200 as the first review lands teaches
          // crawlers worse things than a thin honest page does.
          <div className="mt-4 space-y-4">
            <p className="text-muted-foreground">
              No reviews yet. We&rsquo;re collecting them from doctors and
              students using {SITE_NAME} — the first one will appear here.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/register">Start free</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/#pricing">See pricing</Link>
              </Button>
            </div>
          </div>
        )}
      </header>

      {live && (
        <>
          <ul className="space-y-4">
            {rows.map((review) => (
              <li key={review.id}>
                <ReviewCard review={review} />
              </li>
            ))}
          </ul>

          {result.pageCount > 1 && (
            <Pager
              page={result.page}
              pageCount={result.pageCount}
              total={summary.count}
              shown={rows.length}
              pageSize={REVIEWS_PAGE_SIZE}
              basePath="/reviews"
              params={sp}
            />
          )}
        </>
      )}
    </div>
  );
}
