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
  process.env.NEXT_PUBLIC_SITE_URL || "https://www.cmeqbank.com"
).replace(/\/$/, "");

export const SITE_NAME = "cmeprep.me";

export const SITE_TAGLINE =
  "Pass your Medical Board and Exit Examinations";

/**
 * Used as the default description and by the OG image. Kept near 155
 * characters — Google truncates search snippets around there.
 */
export const SITE_DESCRIPTION =
  "Practice questions and timed mock exams for medical board and exit examinations — CAMC, USMLE, PLAB, NCLEX, MBBS and OSCE. Start free.";

export const SUPPORT_EMAIL = "support@cmeprep.me";

/**
 * WhatsApp contact.
 *
 * Stored in E.164 (leading +, no spaces) as the canonical form, with the
 * grouped version kept separately for display — +592 is Guyana and the
 * national number is seven digits, which no generic formatter gets right.
 */
export const WHATSAPP_NUMBER = "+5926419483";
export const WHATSAPP_DISPLAY = "+592 641 9483";

/**
 * wa.me takes digits only — a leading + or any spaces produce a "phone number
 * shared via url is invalid" page rather than a chat.
 */
export const WHATSAPP_HREF = `https://wa.me/${WHATSAPP_NUMBER.replace(/\D/g, "")}`;

/**
 * Social profiles, rendered by components/marketing/social-links.tsx.
 *
 * Fill in the `href` to publish a link. An entry with an empty href renders
 * nothing at all — same rule as the SECTIONS array on the About page: an
 * unfinished entry must never reach a live marketing page, and a social icon
 * that goes nowhere is worse than no icon.
 */
export type SocialPlatform = "instagram" | "facebook" | "whatsapp";

export const SOCIAL_LINKS: readonly {
  platform: SocialPlatform;
  label: string;
  href: string;
}[] = [
  { platform: "instagram", label: "Instagram", href: "https://www.instagram.com/cmeprep/" },
  { platform: "facebook", label: "Facebook", href: "https://www.facebook.com/CmePrep" },
  { platform: "whatsapp", label: "WhatsApp", href: WHATSAPP_HREF },
];

/** Only the profiles that actually have a URL. */
export function activeSocialLinks() {
  return SOCIAL_LINKS.filter((link) => link.href.trim() !== "");
}

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
