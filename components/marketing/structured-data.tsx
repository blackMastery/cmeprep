import {
  absoluteUrl,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  SUPPORT_EMAIL,
} from "@/lib/site";
import { LOGO_SRC } from "@/components/brand/logo";

/**
 * Schema.org JSON-LD for the marketing home page.
 *
 * Organization + WebSite is the pair that actually earns something: the
 * knowledge-panel entity, and the sitelinks search box. Product/Offer is
 * deliberately omitted — plan prices live in the database and drift, and
 * markup that disagrees with the visible page is a manual-action risk.
 *
 * Rendered as a plain <script>, which is how Next documents JSON-LD; the
 * payload is built from constants here, never from user input.
 */
export function MarketingStructuredData({
  startingPrice,
}: {
  /** Lowest active paid price in dollars, e.g. 72. Omitted when unknown. */
  startingPrice?: number;
}) {
  const organization = {
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
      availableLanguage: "English",
    },
  };

  const website = {
    "@type": "WebSite",
    "@id": absoluteUrl("/#website"),
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    publisher: { "@id": absoluteUrl("/#organization") },
    inLanguage: "en",
  };

  const service = {
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

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [organization, website, service],
        }),
      }}
    />
  );
}
