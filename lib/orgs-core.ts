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
/** Rolling window for risk accuracy (SPEC §8, tune with real cohort data). */
export const RISK_ROLLING_DAYS = 30;
/** Below this many window attempts, all-time accuracy decides instead. */
export const RISK_MIN_WINDOW_ATTEMPTS = 20;

export type RiskReason = "below_pass_mark" | "inactive";

export type MemberRisk = {
  atRisk: boolean;
  reasons: RiskReason[];
  /** The accuracy the pass-mark check actually used; null = no attempts. */
  accuracyPct: number | null;
};

/**
 * Is this member at risk (SPEC §8)? Two independent triggers:
 *
 *  - rolling accuracy below the org's pass mark — the 30-day window when it
 *    has enough attempts to mean something, all-time otherwise. Equalling
 *    the threshold is NOT at risk; the mark is "what passes".
 *  - no activity for the org's inactivity window. Someone who never
 *    practised at all is inactive, not "below the mark" — there is no
 *    accuracy to be below with zero attempts.
 */
export function memberRisk(
  input: {
    passMarkPct: number;
    inactivityDays: number;
    windowAttempts: number;
    windowCorrect: number;
    allTimeAttempts: number;
    allTimeCorrect: number;
    /** Most recent activity date (YYYY-MM-DD); null = never. */
    lastActiveDay: string | null;
  },
  now: Date
): MemberRisk {
  const reasons: RiskReason[] = [];

  const useWindow = input.windowAttempts >= RISK_MIN_WINDOW_ATTEMPTS;
  const attempts = useWindow ? input.windowAttempts : input.allTimeAttempts;
  const correct = useWindow ? input.windowCorrect : input.allTimeCorrect;
  const accuracyPct =
    attempts > 0 ? Math.round((correct / attempts) * 100) : null;

  if (accuracyPct !== null && accuracyPct < input.passMarkPct) {
    reasons.push("below_pass_mark");
  }

  const inactive =
    input.lastActiveDay === null ||
    now.getTime() - new Date(`${input.lastActiveDay}T00:00:00Z`).getTime() >
      input.inactivityDays * DAY_MS;
  if (inactive) reasons.push("inactive");

  return { atRisk: reasons.length > 0, reasons, accuracyPct };
}

export type AssignmentStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "completed_late"
  | "overdue";

/**
 * One member's standing on one assignment (SPEC §7).
 *
 * A SUBMITTED attempt completes it forever — even a late one (flagged), and
 * even past further attempts; the dashboard reports the latest score
 * separately. "overdue" is strictly "due date passed with nothing submitted";
 * an in-progress attempt past the due date still shows as in_progress, since
 * the timer will resolve it within hours either way.
 */
export function assignmentStatus(
  input: {
    dueAt: string;
    /** Latest SUBMITTED attempt's submitted_at; null = none submitted. */
    submittedAt: string | null;
    /** Any attempt exists (in-progress ones included). */
    hasAttempt: boolean;
  },
  now: Date
): AssignmentStatus {
  if (input.submittedAt !== null) {
    return new Date(input.submittedAt) > new Date(input.dueAt)
      ? "completed_late"
      : "completed";
  }
  if (input.hasAttempt) return "in_progress";
  return now > new Date(input.dueAt) ? "overdue" : "not_started";
}

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
