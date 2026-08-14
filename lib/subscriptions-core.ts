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

/* ── Compact uuid codec for the org custom_id ─────────────────
 *
 * An org purchase names FOUR ids (buyer, plan, org, exam). Four plain uuids
 * would be 154 chars — over PayPal's 127-char custom_id cap — so uuids are
 * carried as unpadded base64url (22 chars each). Hand-rolled rather than
 * Buffer/atob so the module stays pure, runtime-agnostic and vitest-trivial.
 * The codec never inspects version/variant bits, so the non-RFC seed ids
 * (e0000000-…) round-trip like any other 128-bit value.
 */

const B64U_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function encodeUuidB64u(uuid: string): string {
  const hex = uuid.replace(/-/g, "").toLowerCase();
  const bytes: number[] = [];
  for (let i = 0; i < 32; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  let out = "";
  for (let i = 0; i < 15; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      B64U_ALPHABET[(n >> 18) & 63] +
      B64U_ALPHABET[(n >> 12) & 63] +
      B64U_ALPHABET[(n >> 6) & 63] +
      B64U_ALPHABET[n & 63];
  }
  // 16th byte: 8 bits → two chars, low 4 bits of the second char zero.
  out += B64U_ALPHABET[(bytes[15] >> 2) & 63] + B64U_ALPHABET[(bytes[15] & 3) << 4];
  return out;
}

export function decodeUuidB64u(s: string): string | null {
  if (s.length !== 22) return null;
  const values: number[] = [];
  for (const ch of s) {
    const v = B64U_ALPHABET.indexOf(ch);
    if (v === -1) return null;
    values.push(v);
  }
  const bytes: number[] = [];
  for (let i = 0; i < 20; i += 4) {
    const n =
      (values[i] << 18) | (values[i + 1] << 12) | (values[i + 2] << 6) | values[i + 3];
    bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }
  bytes.push((values[20] << 2) | (values[21] >> 4));
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  // Canonicality check: the 132-bit string has 4 spare bits that must be
  // zero. Re-encoding is the cheapest way to reject non-canonical spellings
  // of the same uuid, which would otherwise defeat the strict parse.
  return encodeUuidB64u(uuid) === s ? uuid : null;
}

/**
 * Org purchases get a VERSIONED, base64url-packed format: "orgv2:" can never
 * collide with a uuid, so the two shapes stay unambiguous on every parse path
 * forever, and 6 + 4×22 + 3 ":" = 97 chars sits well under PayPal's 127.
 * ("orgv1:" carried three plain uuids and no exam; it never shipped, so the
 * parser refuses it outright rather than dragging a legacy branch forever.)
 *
 * `examId` is required, not optional — an optional parameter would let a
 * future caller silently mint an all-access order, same posture as the
 * personal format above.
 */
const ORG_CUSTOM_ID_PREFIX = "orgv2:";

export function formatOrgPurchaseCustomId(
  userId: string,
  planId: string,
  orgId: string,
  examId: string
): string {
  return (
    ORG_CUSTOM_ID_PREFIX +
    [userId, planId, orgId, examId].map(encodeUuidB64u).join(":")
  );
}

export type ParsedCustomId =
  | ({ kind: "personal" } & PurchaseCustomId)
  | { kind: "org"; userId: string; planId: string; orgId: string; examId: string };

/**
 * The one entry point for reading a custom_id back off PayPal. A malformed
 * org payload returns null rather than falling through to the personal
 * parser — the prefix declared an intent, and half-parsing it as a personal
 * purchase would grant the wrong product.
 */
export function parseAnyPurchaseCustomId(
  customId: string | null | undefined
): ParsedCustomId | null {
  if (!customId) return null;

  if (customId.startsWith(ORG_CUSTOM_ID_PREFIX)) {
    const parts = customId.slice(ORG_CUSTOM_ID_PREFIX.length).split(":");
    if (parts.length !== 4) return null;
    const decoded = parts.map(decodeUuidB64u);
    if (decoded.some((d) => d === null)) return null;
    const [userId, planId, orgId, examId] = decoded as string[];
    return { kind: "org", userId, planId, orgId, examId };
  }

  const personal = parsePurchaseCustomId(customId);
  return personal ? { kind: "personal", ...personal } : null;
}

/** PayPal amounts are decimal strings: 14400 cents → "144.00". */
export function centsToValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

// The inverse, valueToCents, lives in lib/payments-core.ts with the rest of the
// money-record arithmetic — this module is imported by the order-CREATION route,
// which never reads an amount back.

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
