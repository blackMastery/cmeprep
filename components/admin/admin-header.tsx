import Link from "next/link";
import { ArrowLeft, FolderTree, ListChecks } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function AdminHeader({ user }: { user: SessionUser }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 sm:gap-4">
        <Logo href="/admin" size="sm" />
        <Badge variant="secondary" className="hidden lg:inline-flex">
          Admin
        </Badge>

        {/* Labels collapse to icons on narrow screens so the bar never
            outgrows the viewport. */}
        <nav className="flex min-w-0 items-center gap-0.5 sm:ml-2 sm:gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/questions">
              <ListChecks data-icon="inline-start" />
              <span className="hidden sm:inline">Questions</span>
              <span className="sr-only sm:hidden">Questions</span>
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/subjects">
              <FolderTree data-icon="inline-start" />
              <span className="hidden sm:inline">Subjects</span>
              <span className="sr-only sm:hidden">Subjects</span>
            </Link>
          </Button>
        </nav>

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
