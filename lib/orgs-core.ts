/**
 * Pure org rules: the grace/lock state machine, seat math and invite
 * validity (SPEC.md §3–§5).
 *
 * Pure so vitest can exercise every branch — the DB-touching org layer is
 * lib/orgs.ts. The stale-'active' subscription rule is NOT restated here;
 * grace is layered on top of isEffectivelyActive from subscriptions-core.
 */

import {
  isEffectivelyActive,
  type SubscriptionLike,
} from "@/lib/subscriptions-core";

/**
 * Renewals go through hospital accounts-payable departments; a PO stuck in
 * processing must not lock 90 staff out overnight. Cancellation gets no
 * grace — it is a decision, not a payment delay.
 */
export const ORG_GRACE_DAYS = 14;

export const ORG_INVITE_TTL_DAYS = 14;

const DAY_MS = 86_400_000;

/**
 * Lifecycle state driving both the entitlement and the banners:
 * active → grace → locked.
 */
export type OrgSubscriptionState = "active" | "grace" | "locked";

/** When a lapsed-but-uncancelled period stops granting. */
export function orgGraceEnd(periodEnd: string): Date {
  return new Date(new Date(periodEnd).getTime() + ORG_GRACE_DAYS * DAY_MS);
}

/**
 * State across ALL of an org's subscription rows: any effectively-active row
 * keeps the org "active" (renewals stack, so old lapsed rows linger); failing
 * that, an 'active'-status row inside its grace window yields "grace".
 */
export function orgSubscriptionState(
  subs: readonly SubscriptionLike[],
  now: Date
): OrgSubscriptionState {
  let state: OrgSubscriptionState = "locked";
  for (const sub of subs) {
    if (isEffectivelyActive(sub, now)) return "active";
    if (sub.status === "active" && now < orgGraceEnd(sub.current_period_end)) {
      state = "grace";
    }
  }
  return state;
}

/**
 * Does the org grant access right now? Suspension trumps everything —
 * it is the platform-side kill switch, not a billing state.
 */
export function orgGrantHolds(
  org: { suspended_at: string | null },
  subs: readonly SubscriptionLike[],
  now: Date
): boolean {
  if (org.suspended_at !== null) return false;
  return orgSubscriptionState(subs, now) !== "locked";
}

/** An invite row as the seat and acceptance rules see it. */
export type InviteLike = {
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

/** Pending = still occupying a seat and still acceptable. */
export function isInvitePending(invite: InviteLike, now: Date): boolean {
  return (
    invite.accepted_at === null &&
    invite.revoked_at === null &&
    new Date(invite.expires_at) > now
  );
}

/**
 * Seats used = accepted members + PENDING invites (SPEC §4). Strict on
 * purpose: an invited seat is a promised seat, or an org could invite 300
 * and let the first 90 win at accept time.
 */
export function seatsUsed(
  memberCount: number,
  invites: readonly InviteLike[],
  now: Date
): number {
  return memberCount + invites.filter((i) => isInvitePending(i, now)).length;
}

/** How many NEW invites fit right now; 0 when full. */
export function seatsAvailable(
  seatLimit: number,
  memberCount: number,
  invites: readonly InviteLike[],
  now: Date
): number {
  return Math.max(0, seatLimit - seatsUsed(memberCount, invites, now));
}

export function inviteExpiresAt(created: Date): Date {
  return new Date(created.getTime() + ORG_INVITE_TTL_DAYS * DAY_MS);
}

export type InviteAcceptBlocker =
  | "revoked"
  | "accepted"
  | "expired"
  | "email_mismatch";

/**
 * Why this session cannot accept this invite, or null when it can.
 *
 * Email binding is STRICT (SPEC §4): case-insensitive (the column is citext)
 * but never cross-address — a forwarded invite must not let a different
 * account into the org. Terminal states are reported before expiry so a
 * revoked-and-also-expired invite says "revoked", the state an org-admin
 * chose.
 */
/**
 * "jane@hospital.org" → "j***@hospital.org", for telling a mismatched
 * session WHICH address the invite is bound to without handing the whole
 * thing to whoever the link was forwarded to.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

export function inviteAcceptBlocker(
  invite: InviteLike & { email: string },
  sessionEmail: string,
  now: Date
): InviteAcceptBlocker | null {
  if (invite.revoked_at !== null) return "revoked";
  if (invite.accepted_at !== null) return "accepted";
  if (new Date(invite.expires_at) <= now) return "expired";
  if (
    invite.email.trim().toLowerCase() !== sessionEmail.trim().toLowerCase()
  ) {
    return "email_mismatch";
  }
  return null;
}
