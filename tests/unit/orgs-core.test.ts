import { describe, expect, it } from "vitest";
import {
  assignmentStatus,
  inviteAcceptBlocker,
  inviteExpiresAt,
  isInvitePending,
  maskEmail,
  orgGraceEnd,
  orgGrantHolds,
  orgSubscriptionState,
  seatsAvailable,
  seatsUsed,
  type InviteLike,
} from "@/lib/orgs-core";
import type { SubscriptionLike } from "@/lib/subscriptions-core";

const NOW = new Date("2026-08-13T12:00:00Z");
const FUTURE = "2026-12-01T12:00:00Z";
const PAST = "2026-06-01T12:00:00Z";
// Period ended 5 days ago — inside the 14-day grace window.
const IN_GRACE = "2026-08-08T12:00:00Z";

const sub = (
  end: string,
  status: SubscriptionLike["status"] = "active"
): SubscriptionLike => ({ status, current_period_end: end });

describe("orgSubscriptionState", () => {
  it("is active while any row is effectively active", () => {
    // Renewals stack, so a long-lapsed old row alongside a live one is the
    // normal shape, not an edge case.
    expect(orgSubscriptionState([sub(PAST), sub(FUTURE)], NOW)).toBe("active");
  });

  it("moves to grace when the period has ended within 14 days", () => {
    expect(orgSubscriptionState([sub(IN_GRACE)], NOW)).toBe("grace");
  });

  it("locks exactly when grace runs out", () => {
    const end = "2026-07-30T12:00:00Z";
    const graceEnd = orgGraceEnd(end); // 2026-08-13T12:00:00Z
    expect(orgSubscriptionState([sub(end)], new Date(graceEnd.getTime() - 1))).toBe(
      "grace"
    );
    expect(orgSubscriptionState([sub(end)], graceEnd)).toBe("locked");
  });

  it("gives cancelled rows no grace — cancellation is a decision", () => {
    expect(orgSubscriptionState([sub(IN_GRACE, "cancelled")], NOW)).toBe(
      "locked"
    );
    // A cancelled row with a future end is stale data, not access.
    expect(orgSubscriptionState([sub(FUTURE, "cancelled")], NOW)).toBe(
      "locked"
    );
  });

  it("locks an org with no rows at all", () => {
    // The self-serve path creates the org BEFORE any purchase (SPEC §5).
    expect(orgSubscriptionState([], NOW)).toBe("locked");
  });
});

describe("orgGrantHolds", () => {
  const entitled = [sub(FUTURE)];

  it("grants while active and unsuspended", () => {
    expect(orgGrantHolds({ suspended_at: null }, entitled, NOW)).toBe(true);
  });

  it("grants through grace", () => {
    expect(orgGrantHolds({ suspended_at: null }, [sub(IN_GRACE)], NOW)).toBe(
      true
    );
  });

  it("suspension trumps a live subscription", () => {
    expect(orgGrantHolds({ suspended_at: PAST }, entitled, NOW)).toBe(false);
  });

  it("does not grant once locked", () => {
    expect(orgGrantHolds({ suspended_at: null }, [sub(PAST)], NOW)).toBe(false);
  });
});

const invite = (over: Partial<InviteLike> = {}): InviteLike => ({
  expires_at: FUTURE,
  accepted_at: null,
  revoked_at: null,
  ...over,
});

describe("seat math", () => {
  it("counts accepted members plus pending invites", () => {
    const invites = [
      invite(), // pending — counts
      invite({ accepted_at: PAST }), // already a member — counted there
      invite({ revoked_at: PAST }), // revoked — freed
      invite({ expires_at: PAST }), // expired — freed
    ];
    expect(seatsUsed(3, invites, NOW)).toBe(4);
    expect(seatsAvailable(5, 3, invites, NOW)).toBe(1);
  });

  it("refuses to go negative when over cap", () => {
    // Platform admin can LOWER seat_limit below current usage; the org can
    // then remove people but not add — never a negative invite budget.
    expect(seatsAvailable(2, 3, [invite()], NOW)).toBe(0);
  });

  it("frees a seat the moment an invite expires", () => {
    const expiring = invite({ expires_at: "2026-08-13T12:00:00Z" });
    expect(isInvitePending(expiring, new Date("2026-08-13T11:59:59Z"))).toBe(
      true
    );
    expect(isInvitePending(expiring, NOW)).toBe(false);
  });

  it("stamps the 14-day invite TTL", () => {
    expect(inviteExpiresAt(NOW).toISOString()).toBe(
      "2026-08-27T12:00:00.000Z"
    );
  });
});

describe("inviteAcceptBlocker", () => {
  const EMAIL = "jane@hospital.org";
  const forJane = { ...invite(), email: EMAIL };

  it("accepts the exact invited address, case-insensitively", () => {
    expect(inviteAcceptBlocker(forJane, EMAIL, NOW)).toBeNull();
    expect(inviteAcceptBlocker(forJane, "Jane@Hospital.ORG", NOW)).toBeNull();
  });

  it("binds strictly to the invited email — no claiming", () => {
    expect(inviteAcceptBlocker(forJane, "jane.doe@gmail.com", NOW)).toBe(
      "email_mismatch"
    );
  });

  it("reports terminal states before expiry", () => {
    // A revoked-and-also-expired invite says "revoked" — the state an
    // org-admin chose, not the one the calendar imposed.
    expect(
      inviteAcceptBlocker(
        { ...invite({ revoked_at: PAST, expires_at: PAST }), email: EMAIL },
        EMAIL,
        NOW
      )
    ).toBe("revoked");
    expect(
      inviteAcceptBlocker(
        { ...invite({ accepted_at: PAST }), email: EMAIL },
        EMAIL,
        NOW
      )
    ).toBe("accepted");
  });

  it("blocks an expired invite even for the right address", () => {
    expect(
      inviteAcceptBlocker(
        { ...invite({ expires_at: PAST }), email: EMAIL },
        EMAIL,
        NOW
      )
    ).toBe("expired");
  });
});

describe("assignmentStatus", () => {
  const DUE = "2026-08-20T12:00:00Z";
  const base = { dueAt: DUE, submittedAt: null, hasAttempt: false };

  it("walks not_started → in_progress → completed", () => {
    expect(assignmentStatus(base, NOW)).toBe("not_started");
    expect(assignmentStatus({ ...base, hasAttempt: true }, NOW)).toBe(
      "in_progress"
    );
    expect(
      assignmentStatus(
        { ...base, hasAttempt: true, submittedAt: "2026-08-19T12:00:00Z" },
        NOW
      )
    ).toBe("completed");
  });

  it("flags a submission after the due date as late, not overdue", () => {
    expect(
      assignmentStatus(
        { ...base, hasAttempt: true, submittedAt: "2026-08-21T12:00:00Z" },
        new Date("2026-08-22T12:00:00Z")
      )
    ).toBe("completed_late");
  });

  it("goes overdue only when nothing was submitted past the due date", () => {
    const after = new Date("2026-08-21T12:00:00Z");
    expect(assignmentStatus(base, after)).toBe("overdue");
    // An attempt still running past due stays in_progress — the timer will
    // resolve it within hours either way.
    expect(assignmentStatus({ ...base, hasAttempt: true }, after)).toBe(
      "in_progress"
    );
  });
});

describe("maskEmail", () => {
  it("keeps the first character and the domain", () => {
    expect(maskEmail("jane@hospital.org")).toBe("j***@hospital.org");
  });

  it("does not crash on garbage", () => {
    expect(maskEmail("not-an-email")).toBe("***");
    expect(maskEmail("@lost.local")).toBe("***");
  });
});
