import type { MetadataRoute } from "next";
import { absoluteUrl, SITE_URL } from "@/lib/site";

/**
 * Only the marketing surface is crawlable.
 *
 * Everything behind auth already redirects to /login for a crawler, but
 * disallowing it explicitly stops Google spending crawl budget on redirect
 * chains and stops those URLs surfacing as "Blocked"/soft-404 in Search
 * Console. The `noindex` on the (app) and admin layouts is the real control;
 * this is the polite version of the same statement.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin",
        "/dashboard",
        "/profile",
        "/bookmarks",
        "/tests",
        "/checkout",
        "/auth/",
        "/banned",
        "/reset-password",
        "/verify-email",
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
