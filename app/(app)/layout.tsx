import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getOrgMembership } from "@/lib/orgs";
import { orgLogoUrl } from "@/lib/storage";
import { AppHeader } from "@/components/app/app-header";
import { AppChrome } from "@/components/app/app-chrome";
import { AppSidebar } from "@/components/app/app-nav";
import { TutorWidgetProvider } from "@/components/tutor/tutor-widget-provider";
import { TutorWidget } from "@/components/tutor/tutor-widget";
import { tutorApiUrl } from "@/lib/tutor";

/**
 * Nothing behind auth belongs in an index. A crawler only ever sees the
 * /login redirect, but saying so explicitly keeps these URLs out of Search
 * Console as soft 404s, and stops a leaked share link being indexable.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Authoritative gate for the whole authenticated area. proxy.ts does a cheap
 * cookie check for fast redirects; this layout is where the session is
 * actually validated and the profile (role, banned) is loaded.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  // Nav flags only — pages that ACT on org status run their own guards.
  const membership = await getOrgMembership(user.id);
  const orgAdmin = membership?.membership.role === "admin";
  const orgMember = membership !== null;
  const orgBrand = membership
    ? {
        name: membership.org.name,
        logoUrl: orgLogoUrl(membership.org.logo_path),
      }
    : null;

  // --app-header-h is the single source of truth for the sticky header's
  // height: AppHeader sizes itself from it, and full-height screens such as
  // the new-test wizard subtract it from 100dvh.
  //
  // The floating AI tutor (SPEC §18) lives here so one conversation store
  // outlives page navigation. `available` is an env read — the widget must
  // not cost a query on every authenticated page; it fetches on first open.
  return (
    <TutorWidgetProvider available={tutorApiUrl() !== null}>
      <div className="flex min-h-svh flex-col [--app-header-h:--spacing(16)]">
        <AppChrome>
          <AppHeader
            user={user}
            orgAdmin={orgAdmin}
            orgMember={orgMember}
            orgBrand={orgBrand}
          />
        </AppChrome>
        <div className="flex flex-1">
          <AppChrome>
            <AppSidebar user={user} orgAdmin={orgAdmin} orgMember={orgMember} />
          </AppChrome>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
      <TutorWidget />
    </TutorWidgetProvider>
  );
}
