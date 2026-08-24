import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { AccountMenu } from "@/components/app/account-menu";
import { AdminMobileNav, type AdminNavBadges } from "@/components/admin/admin-nav";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function AdminHeader({
  user,
  badges,
}: {
  user: SessionUser;
  badges?: AdminNavBadges;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="flex h-16 w-full items-center gap-2 px-4 sm:gap-4">
        <AdminMobileNav badges={badges} />
        <Logo href="/admin" size="sm" />
        <Badge variant="secondary" className="hidden sm:inline-flex">
          Admin
        </Badge>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button variant="outline-muted" size="sm" asChild>
            <Link href="/dashboard">
              <ArrowLeft data-icon="inline-start" />
              <span className="hidden sm:inline">Back to app</span>
              <span className="sr-only sm:hidden">Back to app</span>
            </Link>
          </Button>

          {/* The account menu, not a bare email label: signing out had meant
              leaving /admin first, and the address the header used to print
              was hidden below lg — so on a phone you could not even tell
              which account you were administering as. */}
          <AccountMenu user={user} />
        </div>
      </div>
    </header>
  );
}
