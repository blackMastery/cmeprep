import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

/**
 * Public, indexable routes only — the pages a stranger can reach and that say
 * something. Authenticated routes are noindex, and the transactional auth
 * pages (reset-password, verify-email) are noise in a sitemap.
 *
 * lastModified is deploy time rather than a hardcoded date: these pages
 * change when the app does, and a stale date teaches crawlers to check less
 * often.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    {
      url: absoluteUrl("/"),
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: absoluteUrl("/teams"),
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: absoluteUrl("/register"),
      lastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: absoluteUrl("/login"),
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
