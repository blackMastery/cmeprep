import Link from "next/link";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SUPPORT_EMAIL } from "@/lib/site";

/**
 * Grace/lock messaging (SPEC §5). Two audiences, two tones:
 * org-admins get the loud version with the renewal path; members get a calm
 * note only when it is about to affect them (final 3 days of grace) or
 * already has (locked).
 */

export function OrgAdminAccessBanner({
  state,
  suspended,
  graceEndsAt,
  everSubscribed = true,
}: {
  state: "active" | "grace" | "locked";
  suspended: boolean;
  graceEndsAt: string | null;
  /** False for an org that has never held a plan — nothing lapsed, so the
      locked copy must not talk about losing access or renewing. */
  everSubscribed?: boolean;
}) {
  if (suspended) {
    return (
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3">
        <AlertTriangle className="size-5 shrink-0 text-destructive" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm">
          This organisation is <span className="font-semibold">suspended</span>{" "}
          — members have no access. Contact {SUPPORT_EMAIL}.
        </p>
      </div>
    );
  }
  if (state === "active") return null;

  return (
    <div
      className={
        state === "grace"
          ? "mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-sun/60 bg-sun/15 px-4 py-3"
          : "mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3"
      }
    >
      <CalendarClock
        className={
          state === "grace"
            ? "size-5 shrink-0 text-ink"
            : "size-5 shrink-0 text-destructive"
        }
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 text-sm">
        {state === "grace" && graceEndsAt ? (
          <>
            Your plan has lapsed — access ends for your whole team on{" "}
            <span className="font-semibold">
              {new Date(graceEndsAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
              })}
            </span>
            . Renew to keep everyone studying.
          </>
        ) : everSubscribed ? (
          <>
            Your organisation has{" "}
            <span className="font-semibold">no active plan</span> — members
            have lost access until it renews.
          </>
        ) : (
          <>
            Your organisation has{" "}
            <span className="font-semibold">no plan yet</span> — choose an
            examination to give your team access.
          </>
        )}
      </p>
      <Button size="sm" asChild>
        <Link href="/org/billing">
          {everSubscribed ? "Renew now" : "Choose a plan"}
        </Link>
      </Button>
    </div>
  );
}

export function MemberAccessBanner({
  state,
  orgName,
  graceEndsAt,
  daysLeft,
}: {
  state: "active" | "grace" | "locked";
  orgName: string;
  graceEndsAt: string | null;
  daysLeft: number;
}) {
  // Members only hear about it when it's imminent or real (SPEC §5).
  if (state === "grace" && graceEndsAt && daysLeft <= 3) {
    return (
      <div className="mb-6 rounded-xl border border-sun/60 bg-sun/15 px-4 py-3 text-sm">
        {orgName}&apos;s plan is renewing — if nothing changes, your access
        pauses on{" "}
        {new Date(graceEndsAt).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
        })}
        . Nothing you need to do.
      </div>
    );
  }
  if (state === "locked") {
    return (
      <div className="mb-6 rounded-xl border border-border bg-secondary/50 px-4 py-3 text-sm">
        {orgName}&apos;s plan has ended, so organisation access is paused.
        Your history and results are safe, and everything returns the moment
        it renews.
      </div>
    );
  }
  return null;
}
