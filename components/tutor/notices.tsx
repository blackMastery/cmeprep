"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { Blocked } from "@/components/tutor/use-tutor-conversation";

/** A spent allowance or a missing subscription — the SERVER's words. */
export function BlockedNotice({ blocked }: { blocked: Blocked }) {
  return (
    <div className="rounded-xl border border-border bg-muted/50 px-4 py-3">
      <p className="text-sm text-muted-foreground">{blocked.message}</p>
      {blocked.upsell && (
        <Button size="sm" className="mt-2.5" asChild>
          <Link href="/#pricing">View plans</Link>
        </Button>
      )}
    </div>
  );
}

/**
 * The session ended under the widget (a 401 mid-session — almost always a
 * sign-out in another tab). A plain anchor, not a router push: the login
 * round trip must re-run requireUser, and ?next= brings the student back.
 */
export function SignedOutNotice() {
  const pathname = usePathname();
  return (
    <div className="rounded-xl border border-border bg-muted/50 px-4 py-3">
      <p className="text-sm text-muted-foreground">
        Your session has ended — sign in to keep going.
      </p>
      <Button size="sm" className="mt-2.5" asChild>
        <a href={`/login?next=${encodeURIComponent(pathname)}`}>Sign in</a>
      </Button>
    </div>
  );
}

export function LoadErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/50 px-4 py-3">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button size="sm" variant="outline" className="mt-2.5" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
