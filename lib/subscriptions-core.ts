/**
 * Pure helpers for the PayPal purchase flow. No `server-only` import so
 * vitest can exercise them; DB-touching subscription logic lives in
 * lib/subscriptions.ts.
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
