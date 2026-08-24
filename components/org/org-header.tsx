import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { AccountMenu } from "@/components/app/account-menu";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { OrgMobileNav } from "@/components/org/org-nav";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

/**
 * Header for the org-admin area. Mirrors the admin header, with two
 * differences: the organisation's own name/logo is shown at every width
 * because it is the identity of this area, and the theme toggle stays —
 * org admins are learners who have it in the app shell and would notice
 * losing it here.
 */
export function OrgHeader({
  user,
  org,
}: {
  user: SessionUser;
  org: { name: string; logoUrl: string | null };
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      {/* h-16: the shared Sidebar pins itself at top-16. */}
      <div className="flex h-16 w-full items-center gap-2 px-4 sm:gap-4">
        <OrgMobileNav />
        <Logo href="/org" size="sm" />
        <span className="flex min-w-0 items-center gap-2 border-l border-border pl-3">
          {org.logoUrl && (
            // Tiny, arbitrary-aspect asset — the optimizer adds nothing.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={org.logoUrl}
              alt=""
              className="h-6 w-auto max-w-24 object-contain"
            />
          )}
          <span className="truncate text-sm font-medium text-muted-foreground">
            {org.name}
          </span>
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button variant="outline-muted" size="sm" asChild>
            <Link href="/dashboard">
              <ArrowLeft data-icon="inline-start" />
              <span className="hidden sm:inline">Back to app</span>
              <span className="sr-only sm:hidden">Back to app</span>
            </Link>
          </Button>
          <ThemeToggle />
          <AccountMenu user={user} />
        </div>
      </div>
    </header>
  );
}
