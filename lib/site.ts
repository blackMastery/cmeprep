/**
 * Canonical site identity — the single source for every absolute URL the app
 * emits (metadataBase, canonicals, OG tags, sitemap, robots).
 *
 * No `server-only`: metadata objects and route handlers both read this, and
 * nothing here is a secret.
 */

/**
 * `metadataBase` is read at build time, so it cannot fall back to the request
 * host the way lib/(auth)/actions.ts does. An unset NEXT_PUBLIC_SITE_URL in
 * production would silently emit localhost canonicals and de-index the site,
 * so the production domain is the fallback rather than localhost.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://www.cmeprep.me"
).replace(/\/$/, "");

export const SITE_NAME = "cmeprep.me";

export const SITE_TAGLINE =
  "Pass your Medical Board and Exit Examinations";

/**
 * Used as the default description and by the OG image. Kept near 155
 * characters — Google truncates search snippets around there.
 */
export const SITE_DESCRIPTION =
  "Practice questions and timed mock exams for medical board and exit examinations — CAMC, USMLE, PLAB, NCLEX, MBBS and MDCN. Start free.";

export const SUPPORT_EMAIL = "support@cmeprep.me";

/**
 * The generated social cards (app/opengraph-image.tsx, app/twitter-image.tsx).
 *
 * These MUST be repeated on any page that declares its own `openGraph` or
 * `twitter` object. Next replaces those fields wholesale rather than merging
 * them, so a page that sets `openGraph: { url }` and nothing else silently
 * drops the inherited og:image — the tag simply vanishes from the head.
 * Next appends its own cache-busting query to these paths.
 */
export const OG_IMAGE = "/opengraph-image";
export const TWITTER_IMAGE = "/twitter-image";

/** Absolute URL for a site-relative path. */
export function absoluteUrl(path = "/"): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
