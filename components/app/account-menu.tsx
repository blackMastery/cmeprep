import Link from "next/link";
import { LogOut, User as UserIcon, UserRound } from "lucide-react";
import { logout } from "@/app/(auth)/actions";
import type { SessionUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The account dropdown shared by every authenticated header (learner, org
 * admin, platform admin). One copy so a change to sign-out or the profile
 * link cannot land in one header and be missed in another.
 */
export function AccountMenu({ user }: { user: SessionUser }) {
  const { profile } = user;

  return (
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
          <Link href="/profile" className="flex items-center gap-2">
            <UserRound className="size-4" />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <form action={logout} className="w-full">
            <button type="submit" className="flex w-full items-center gap-2">
              <LogOut className="size-4" />
              Log out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
