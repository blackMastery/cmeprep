import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getOrgMembership } from "@/lib/orgs";
import { AppHeader } from "@/components/app/app-header";
import { AppChrome } from "@/components/app/app-chrome";
import { AppSidebar } from "@/components/app/app-nav";

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
  // Nav flag only — pages that ACT on org-admin status run requireOrgAdmin
  // themselves.
  const membership = await getOrgMembership(user.id);
  const orgAdmin = membership?.membership.role === "admin";

  return (
    <div className="flex min-h-svh flex-col">
      <AppChrome>
        <AppHeader user={user} orgAdmin={orgAdmin} />
      </AppChrome>
      <div className="flex flex-1">
        <AppChrome>
          <AppSidebar user={user} orgAdmin={orgAdmin} />
        </AppChrome>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
