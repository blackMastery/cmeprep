/**
 * Pure helpers for the PayPal purchase flow and subscription status display.
 * No `server-only` import so vitest can exercise them; DB-touching
 * subscription logic lives in lib/subscriptions.ts.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * End of the paid period: base + N calendar months, plain JS date semantics.
 * Jan 31 + 1 month overflows to Mar 2/3 — accepted, it only ever rounds in
 * the buyer's favor by a couple of days on 1/3-month plans.
 */
export function computePeriodEnd(durationMonths: number, base: Date): Date {
  const end = new Date(base);
  end.setUTCMonth(end.getUTCMonth() + durationMonths);
  return end;
}

/**
 * Where a new period starts. A buyer who is already active starts at their
 * current period end, never at now() — they paid for full months and
 * repurchasing must not eat remaining time.
 */
export function stackBase(activeEnd: string | null, now: Date): Date {
  return activeEnd && new Date(activeEnd) > now ? new Date(activeEnd) : now;
}

/**
 * `custom_id` on the PayPal purchase unit carries who bought what through the
 * whole round-trip (create → capture → webhook). Three uuids + two ":" = 110
 * chars, under PayPal's 127-char limit.
 *
 * The exam rides HERE rather than in `reference_id` on purpose: the
 * PAYMENT.CAPTURE.* webhook resources expose `custom_id` but not
 * `reference_id`, so splitting the tuple would lose the exam on exactly the
 * reconciliation path that exists to rescue a buyer whose browser died.
 *
 * `examId` is required, not optional — an optional parameter would let a
 * future caller silently mint an all-access order.
 */
export function formatPurchaseCustomId(
  userId: string,
  planId: string,
  examId: string
): string {
  return `${userId}:${planId}:${examId}`;
}

export type PurchaseCustomId = {
  userId: string;
  planId: string;
  /**
   * null ⇒ LEGACY two-segment id: an order created before exam scoping
   * shipped and approved after. Callers must treat it as grandfathered
   * ALL-ACCESS — the buyer paid under blanket terms — never as "whichever
   * exam they ask for". PayPal orders are short-lived, so this should stop
   * occurring within hours of deploy; it is logged so that can be confirmed.
   */
  examId: string | null;
};

export function parsePurchaseCustomId(
  customId: string | null | undefined
): PurchaseCustomId | null {
  if (!customId) return null;

  const parts = customId.split(":");
  if (parts.length < 2 || parts.length > 3) return null;

  const [userId, planId, examId] = parts;
  if (!UUID_RE.test(userId) || !UUID_RE.test(planId)) return null;
  if (parts.length === 3 && !UUID_RE.test(examId)) return null;

  return { userId, planId, examId: parts.length === 3 ? examId : null };
}

/** PayPal amounts are decimal strings: 14400 cents → "144.00". */
export function centsToValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** The fields status logic needs; satisfied by a full Subscription row. */
export type SubscriptionLike = {
  status: "active" | "expired" | "cancelled";
  current_period_end: string;
};

export const EXPIRY_WARNING_DAYS = 7;

/**
 * Stored status can go stale — no job flips lapsed rows to 'expired', so
 * 'active' only counts while the period lasts.
 */
export function isEffectivelyActive(sub: SubscriptionLike, now: Date): boolean {
  return sub.status === "active" && new Date(sub.current_period_end) > now;
}

/** What to show: stale 'active' rows past their end render as 'expired'. */
export function displayStatus(
  sub: SubscriptionLike,
  now: Date
): SubscriptionLike["status"] {
  if (sub.status === "active" && !isEffectivelyActive(sub, now)) {
    return "expired";
  }
  return sub.status;
}

/**
 * When access actually ends: the latest period end among effectively-active
 * rows (purchases stack), or null when none.
 */
export function activePeriodEnd(
  subs: SubscriptionLike[],
  now: Date
): string | null {
  let latest: string | null = null;
  for (const sub of subs) {
    if (!isEffectivelyActive(sub, now)) continue;
    if (latest === null || new Date(sub.current_period_end) > new Date(latest)) {
      latest = sub.current_period_end;
    }
  }
  return latest;
}

/** Whole days until `end`, rounded up; <= 0 once it has passed. */
export function daysUntil(end: string, now: Date): number {
  return Math.ceil((new Date(end).getTime() - now.getTime()) / 86_400_000);
}

// The old single `expiryWarning` lived here. It took the latest end across
// ALL rows, which under exam scoping means a student whose PLAB lapses
// tomorrow gets no warning at all while their USMLE runs a year. Warnings are
// now per-exam: see expiryWarnings in lib/entitlements-core.ts.
