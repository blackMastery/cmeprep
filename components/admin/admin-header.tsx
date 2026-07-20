import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { AdminMobileNav } from "@/components/admin/admin-nav";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function AdminHeader({ user }: { user: SessionUser }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="flex h-16 w-full items-center gap-2 px-4 sm:gap-4">
        <AdminMobileNav />
        <Logo href="/admin" size="sm" />
        <Badge variant="secondary" className="hidden sm:inline-flex">
          Admin
        </Badge>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <span className="hidden max-w-40 truncate text-xs text-muted-foreground lg:inline">
            {user.email}
          </span>
          <Button variant="outline-muted" size="sm" asChild>
            <Link href="/dashboard">
              <ArrowLeft data-icon="inline-start" />
              <span className="hidden sm:inline">Back to app</span>
              <span className="sr-only sm:hidden">Back to app</span>
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
