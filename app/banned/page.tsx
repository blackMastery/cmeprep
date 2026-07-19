import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { logout } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = { title: "Account suspended" };

export default function BannedPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo />
      <span className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldAlert className="size-7" aria-hidden="true" />
      </span>
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-semibold">
          Your account is suspended
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Access to CME Prep has been paused for this account. If you believe
          this is a mistake, contact support@cmeprep.me.
        </p>
      </div>
      <form action={logout}>
        <Button type="submit" variant="outline">
          Log out
        </Button>
      </form>
    </div>
  );
}
