"use client";

import { useSyncExternalStore } from "react";
import { Star, X } from "lucide-react";
import { reviewBannerKey } from "@/lib/site-reviews-core";
import { WriteReviewDialog } from "@/components/site-review-form";

/**
 * A one-time dashboard nudge to review the product.
 *
 * Eligibility is the SERVER's call — it simply does not render this component
 * — so the only thing decided here is whether this person already dismissed
 * it. That lives in localStorage, which is per-device by nature: the banner
 * will reappear on a new device, in a private window and after clearing site
 * data. That was a deliberate trade against adding a table for it.
 *
 * Dismissal is read through useSyncExternalStore, copying the tutor widget:
 * the server snapshot says "dismissed", so nothing renders on the server or
 * through hydration, and the banner appears one frame later. A useState
 * initialiser would mismatch, and a useEffect-then-setState would flash the
 * banner in and then out. The cost is that it never renders without JS, which
 * is acceptable for a nudge.
 */

// Storage throws in private mode / with site data blocked. A nudge must never
// take the dashboard down.
function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return true;
  }
}

const listeners = new Set<() => void>();
const cache = new Map<string, boolean>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function snapshot(key: string): boolean {
  if (!cache.has(key)) cache.set(key, readDismissed(key));
  return cache.get(key)!;
}

function dismiss(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // ignore — the in-memory flag below still hides it for this session
  }
  cache.set(key, true);
  for (const l of listeners) l();
}

export function ReviewBanner({
  userId,
  displayName,
}: {
  userId: string;
  displayName: string;
}) {
  const key = reviewBannerKey(userId);

  const dismissed = useSyncExternalStore(
    subscribe,
    () => snapshot(key),
    // Server snapshot: dismissed, so nothing renders until the client knows.
    () => true,
  );

  if (dismissed) return null;

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-accent/50 px-4 py-3 animate-in fade-in motion-reduce:animate-none">
      <Star className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm">
        You&rsquo;ve put real work in here. Would you write a short review for
        other students?
      </p>
      {/* The dialog does NOT dismiss the banner on success. Dismissing flips
          the store, which unmounts this component and the open dialog with
          it — taking the "permanent, no email" confirmation off screen before
          it is read. The form writes the same localStorage key itself, so the
          banner stays away regardless. */}
      <WriteReviewDialog
        userId={userId}
        displayName={displayName}
        triggerVariant="default"
      />
      <button
        type="button"
        onClick={() => dismiss(key)}
        aria-label="Dismiss"
        className="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
