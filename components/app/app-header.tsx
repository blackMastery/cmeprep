import Link from "next/link";
import { LogOut, User as UserIcon } from "lucide-react";
import { logout } from "@/app/(auth)/actions";
import type { SessionUser } from "@/lib/auth";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/app/theme-toggle";

const ROLE_LABEL: Record<string, string> = {
  trial: "Trial",
  student: "Student",
  admin: "Admin",
};

export function AppHeader({ user }: { user: SessionUser }) {
  const { profile } = user;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4">
        <Logo href="/dashboard" />

        <nav className="ml-4 hidden items-center gap-1 sm:flex">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard">Dashboard</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/tests/new">New test</Link>
          </Button>
          {profile.role === "admin" && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin">Admin</Link>
            </Button>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Badge
            variant={profile.role === "trial" ? "secondary" : "default"}
            className="hidden sm:inline-flex"
          >
            {ROLE_LABEL[profile.role] ?? profile.role}
          </Badge>

          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Account menu">
                <UserIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <span className="block truncate font-medium">
                  {profile.full_name ?? "Your account"}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {profile.role === "trial" && (
                <DropdownMenuItem disabled className="text-xs">
                  Trials used: {profile.trials_used}/{profile.trials_limit}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild>
                <form action={logout} className="w-full">
                  <button
                    type="submit"
                    className="flex w-full items-center gap-2"
                  >
                    <LogOut className="size-4" />
                    Log out
                  </button>
                </form>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
