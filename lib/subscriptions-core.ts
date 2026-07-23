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
 * `custom_id` on the PayPal purchase unit carries who bought what through the
 * whole round-trip (create → capture → webhook). Two uuids + ":" = 73 chars,
 * under PayPal's 127-char limit.
 */
export function formatPurchaseCustomId(userId: string, planId: string): string {
  return `${userId}:${planId}`;
}

export function parsePurchaseCustomId(
  customId: string | null | undefined
): { userId: string; planId: string } | null {
  if (!customId) return null;
  const [userId, planId, ...rest] = customId.split(":");
  if (rest.length > 0 || !UUID_RE.test(userId) || !UUID_RE.test(planId)) {
    return null;
  }
  return { userId, planId };
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

/** Non-null when access ends within EXPIRY_WARNING_DAYS; daysLeft >= 1. */
export function expiryWarning(
  subs: SubscriptionLike[],
  now: Date
): { periodEnd: string; daysLeft: number } | null {
  const end = activePeriodEnd(subs, now);
  if (end === null) return null;
  const daysLeft = Math.ceil(
    (new Date(end).getTime() - now.getTime()) / 86_400_000
  );
  if (daysLeft < 1 || daysLeft > EXPIRY_WARNING_DAYS) return null;
  return { periodEnd: end, daysLeft };
}
