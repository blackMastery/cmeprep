import {
  absoluteUrl,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  SUPPORT_EMAIL,
} from "@/lib/site";
import { LOGO_SRC } from "@/components/brand/logo";

/** A language the site offers; both markup fields need it. */
export type MarkupLanguage = { code: string; name: string };

/**
 * The Organization entity, at a stable @id.
 *
 * Exported as a builder because /reviews emits it too — hanging the review
 * markup off a SECOND, slightly different description of the same company is
 * how two pages start disagreeing about who we are.
 */
export function organizationNode(languages: MarkupLanguage[] = []) {
  return {
    "@type": "Organization",
    "@id": absoluteUrl("/#organization"),
    name: SITE_NAME,
    url: SITE_URL,
    logo: absoluteUrl(LOGO_SRC),
    description: SITE_DESCRIPTION,
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: SUPPORT_EMAIL,
      availableLanguage:
        languages.length > 0
          ? ["English", ...languages.map((l) => l.name)]
          : "English",
    },
  };
}

/**
 * The thing being reviewed, at a stable @id.
 *
 * /reviews spreads this and adds aggregateRating + review[]. Same reason as
 * above: one definition, so the entity's name and description cannot drift
 * between the page that describes it and the page that rates it.
 */
export function programNode({
  startingPrice,
}: { startingPrice?: number } = {}) {
  return {
    "@type": "EducationalOccupationalProgram",
    "@id": absoluteUrl("/#program"),
    name: "Medical board and exit examination preparation",
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    provider: { "@id": absoluteUrl("/#organization") },
    educationalProgramMode: "online",
    occupationalCategory: "Medicine",
    ...(startingPrice !== undefined && {
      offers: {
        "@type": "Offer",
        category: "subscription",
        price: startingPrice,
        priceCurrency: "USD",
        url: absoluteUrl("/#pricing"),
      },
    }),
  };
}

/**
 * Schema.org JSON-LD for the marketing home page.
 *
 * Organization + WebSite is the pair that actually earns something: the
 * knowledge-panel entity, and the sitelinks search box. Product/Offer is
 * deliberately omitted — plan prices live in the database and drift, and
 * markup that disagrees with the visible page is a manual-action risk.
 *
 * No aggregateRating here either, for the same reason: this page shows a
 * hand-picked handful of reviews, so an average over ALL of them would be a
 * claim the page does not evidence. That markup lives on /reviews, which
 * renders every review it counts. See reviews-structured-data.tsx.
 *
 * Rendered as a plain <script>, which is how Next documents JSON-LD; the
 * payload is built from constants here, never from user input.
 */
export function MarketingStructuredData({
  startingPrice,
  languages = [],
}: {
  /** Lowest active paid price in dollars, e.g. 72. Omitted when unknown. */
  startingPrice?: number;
  /** Translation languages switched on (registry code + English name).
   * English stays first so the markup is unchanged while none is enabled. */
  languages?: MarkupLanguage[];
}) {
  const organization = organizationNode(languages);

  const website = {
    "@type": "WebSite",
    "@id": absoluteUrl("/#website"),
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    publisher: { "@id": absoluteUrl("/#organization") },
    inLanguage:
      languages.length > 0 ? ["en", ...languages.map((l) => l.code)] : "en",
  };

  const service = programNode({ startingPrice });

  return <JsonLd graph={[organization, website, service]} />;
}

/**
 * The one JSON-LD emitter. Every schema.org block on the site renders through
 * this, so the escaping below cannot be present on one page and missing on
 * another.
 *
 * JSON.stringify does NOT escape "</script>" inside a <script> element, so a
 * string containing one breaks out of the block. That is a real XSS, not a
 * nicety: /reviews serialises reviewer-written bodies, and this page already
 * serialises a price read from the database. Escaping every "<" also covers
 * "<!--". Assume any node may carry user or DB input.
 */
export function JsonLd({ graph }: { graph: unknown[] }) {
  const payload = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": graph,
  });
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: payload.replace(/</g, "\\u003c") }}
    />
  );
}
