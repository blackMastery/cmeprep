import { describe, expect, it } from "vitest";
import {
  assignmentStatus,
  countsTowardDeptAssignment,
  departmentSummaries,
  guyanaDay,
  inviteAcceptBlocker,
  inviteExpiresAt,
  isInvitePending,
  maskEmail,
  memberReadiness,
  mondayOf,
  orgExamAlerts,
  orgGraceEnd,
  orgGrantHolds,
  orgHeadline,
  orgSubGrants,
  orgSubscriptionState,
  qualifiesAsAssignmentCompletion,
  readinessCsv,
  readinessWindowStart,
  seatsAvailable,
  seatsUsed,
  sittingFraming,
  type InviteLike,
  type MemberReadinessInput,
  type WeeklyModeBucket,
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

describe("orgSubGrants", () => {
  it("grants while effectively active and through grace, not past it", () => {
    expect(orgSubGrants(sub(FUTURE), NOW)).toBe(true);
    expect(orgSubGrants(sub(IN_GRACE), NOW)).toBe(true);
    expect(orgSubGrants(sub(PAST), NOW)).toBe(false);
  });

  it("gives cancelled and expired-status rows nothing", () => {
    expect(orgSubGrants(sub(FUTURE, "cancelled"), NOW)).toBe(false);
    expect(orgSubGrants(sub(IN_GRACE, "cancelled"), NOW)).toBe(false);
    expect(orgSubGrants(sub(FUTURE, "expired"), NOW)).toBe(false);
  });
});

describe("orgExamAlerts", () => {
  const EXAM_A = "e0000000-0000-0000-0000-000000000001";
  const EXAM_B = "e0000000-0000-0000-0000-000000000002";
  const scoped = (
    examId: string | null,
    end: string,
    status: SubscriptionLike["status"] = "active"
  ) => ({ ...sub(end, status), exam_id: examId });

  it("warns per exam while the org-wide state stays active", () => {
    // A in grace, B live — exactly the case orgSubscriptionState cannot see.
    const alerts = orgExamAlerts(
      [scoped(EXAM_A, IN_GRACE), scoped(EXAM_B, FUTURE)],
      NOW
    );
    expect(alerts).toEqual([
      { examId: EXAM_A, endsAt: orgGraceEnd(IN_GRACE).toISOString(), state: "grace" },
    ]);
  });

  it("flags an exam ending within the warning window", () => {
    const soon = "2026-08-16T12:00:00Z"; // 3 days out
    expect(orgExamAlerts([scoped(EXAM_A, soon)], NOW)).toEqual([
      { examId: EXAM_A, endsAt: soon, state: "expiring" },
    ]);
  });

  it("lets a stacked repurchase of the same exam suppress the alert", () => {
    expect(
      orgExamAlerts([scoped(EXAM_A, IN_GRACE), scoped(EXAM_A, FUTURE)], NOW)
    ).toEqual([]);
  });

  it("ignores comp rows, cancelled rows and exams already past grace", () => {
    expect(orgExamAlerts([scoped(null, IN_GRACE)], NOW)).toEqual([]);
    expect(orgExamAlerts([scoped(EXAM_A, IN_GRACE, "cancelled")], NOW)).toEqual([]);
    expect(orgExamAlerts([scoped(EXAM_A, PAST)], NOW)).toEqual([]);
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

describe("qualifiesAsAssignmentCompletion", () => {
  const examTest = {
    mode: "exam" as const,
    status: "submitted",
    answered_questions: 3,
    total_questions: 40,
  };

  it("accepts any submitted exam attempt, blanks included", () => {
    expect(qualifiesAsAssignmentCompletion(examTest)).toBe(true);
    expect(
      qualifiesAsAssignmentCompletion({ ...examTest, answered_questions: 0 })
    ).toBe(true);
    // Legacy rows finalized before answered_questions existed.
    expect(
      qualifiesAsAssignmentCompletion({ ...examTest, answered_questions: null })
    ).toBe(true);
  });

  it("requires every question answered for a tutor session", () => {
    const tutor = { ...examTest, mode: "tutor" as const };
    expect(
      qualifiesAsAssignmentCompletion({ ...tutor, answered_questions: 40 })
    ).toBe(true);
    // The gaming case: 3 easy questions checked, finished at 100%.
    expect(qualifiesAsAssignmentCompletion(tutor)).toBe(false);
    expect(
      qualifiesAsAssignmentCompletion({ ...tutor, answered_questions: 39 })
    ).toBe(false);
    expect(
      qualifiesAsAssignmentCompletion({ ...tutor, answered_questions: null })
    ).toBe(false);
  });

  it("never counts an unsubmitted test in either mode", () => {
    expect(
      qualifiesAsAssignmentCompletion({ ...examTest, status: "in_progress" })
    ).toBe(false);
    expect(
      qualifiesAsAssignmentCompletion({
        ...examTest,
        mode: "tutor",
        status: "in_progress",
        answered_questions: 40,
      })
    ).toBe(false);
  });
});

// NOW (2026-08-13T12:00Z) is a Thursday; in America/Guyana (UTC-4) the civil
// date is the same, so the current ISO week starts Monday 2026-08-10 and the
// 8-week window opens 2026-06-22. The recent trend half is weeks >= 07-20.
describe("readiness week math", () => {
  it("computes the Guyana civil date across the UTC midnight seam", () => {
    expect(guyanaDay(NOW)).toBe("2026-08-13");
    // 03:59Z is 23:59 the previous evening in Guyana.
    expect(guyanaDay(new Date("2026-08-14T03:59:00Z"))).toBe("2026-08-13");
  });

  it("finds the ISO Monday for any weekday including Sunday", () => {
    expect(mondayOf("2026-08-13")).toBe("2026-08-10"); // Thursday
    expect(mondayOf("2026-08-10")).toBe("2026-08-10"); // Monday itself
    expect(mondayOf("2026-08-16")).toBe("2026-08-10"); // Sunday belongs backward
  });

  it("opens the window 8 ISO weeks back", () => {
    expect(readinessWindowStart(NOW)).toBe("2026-06-22");
  });
});

describe("memberReadiness", () => {
  const week = (
    weekStart: string,
    mode: "exam" | "tutor",
    attempts: number,
    correct: number
  ): WeeklyModeBucket => ({ weekStart, mode, attempts, correct });

  // A healthy baseline: 80% exam accuracy vs a 60 mark, full coverage,
  // steady cadence, recent mock, active yesterday.
  const base: MemberReadinessInput = {
    passMarkPct: 60,
    inactivityDays: 7,
    weekly: [week("2026-08-03", "exam", 20, 16)],
    weeklyActiveDays: [{ weekStart: "2026-08-03", days: 12 }],
    allTime: { attempts: 0, correct: 0 },
    subjects: [
      { subjectId: "s1", questionCount: 10, attempts: 10, accuracyPct: 80 },
    ],
    hasExamModeTestInWindow: true,
    lastActiveDay: "2026-08-12",
    joinedAt: "2026-06-01T00:00:00Z",
  };

  it("scores a healthy member on_track with no reasons", () => {
    const r = memberReadiness(base, NOW);
    // accSub 100 (.5) + neutral trend 50 (.15) + coverage 100 (.2) +
    // cadence 100 (.15) = 92.5 → 93.
    expect(r).toMatchObject({
      band: "on_track",
      score: 93,
      reasons: [],
      accuracyPct: 80,
      trendDeltaPct: null,
      coveragePct: 100,
    });
  });

  it("weights exam-mode attempts double in the blend", () => {
    const strongTimed = memberReadiness(
      {
        ...base,
        weekly: [week("2026-08-03", "exam", 20, 20), week("2026-08-03", "tutor", 20, 10)],
      },
      NOW
    );
    const weakTimed = memberReadiness(
      {
        ...base,
        weekly: [week("2026-08-03", "exam", 20, 10), week("2026-08-03", "tutor", 20, 20)],
      },
      NOW
    );
    // Same raw totals (30/40 = 75%) — the mode split moves the blend.
    expect(strongTimed.accuracyPct).toBe(83); // (40+10)/(40+20)
    expect(weakTimed.accuracyPct).toBe(67); // (20+20)/(40+20)
  });

  it("treats accuracy exactly ON the pass mark as not below it", () => {
    const r = memberReadiness(
      { ...base, weekly: [week("2026-08-03", "exam", 20, 12)] }, // 60 vs 60
      NOW
    );
    expect(r.accuracyPct).toBe(60);
    expect(r.reasons).not.toContain("below_pass_mark");
    // accSub 50 (.5=25) + 7.5 + 20 + 15 = 67.5 → 68, borderline.
    expect(r).toMatchObject({ band: "borderline", score: 68 });
  });

  it("caps below on_track without a timed mock in the window", () => {
    const r = memberReadiness({ ...base, hasExamModeTestInWindow: false }, NOW);
    expect(r.score).toBe(74); // would be 93 uncapped
    expect(r.band).toBe("borderline");
    expect(r.reasons[0]).toBe("no_timed_practice"); // cap reasons lead
  });

  it("caps a dormant member and keeps the last computable figure", () => {
    const r = memberReadiness(
      {
        ...base,
        weekly: [],
        weeklyActiveDays: [],
        allTime: { attempts: 100, correct: 90 },
        lastActiveDay: "2026-06-01",
      },
      NOW
    );
    expect(r.accuracyPct).toBe(90); // all-time fallback
    expect(r.reasons).toContain("inactive");
    expect(r.score).toBeLessThanOrEqual(74);
    expect(r.band).not.toBe("insufficient_data");
  });

  it("flags inactivity strictly past N days, never at exactly N", () => {
    // NOW is 08-13T12:00Z; 7 days back is 08-06T12:00Z — an 08-06 midnight
    // stamp is past the window, 08-07 is within it (v1 boundary preserved).
    const active = memberReadiness({ ...base, lastActiveDay: "2026-08-07" }, NOW);
    const inactive = memberReadiness({ ...base, lastActiveDay: "2026-08-06" }, NOW);
    expect(active.reasons).not.toContain("inactive");
    expect(inactive.reasons).toContain("inactive");
  });

  it("reports a declining trend from the recent vs prior halves", () => {
    const r = memberReadiness(
      {
        ...base,
        weekly: [
          week("2026-06-29", "exam", 20, 10), // prior half: 50%
          week("2026-08-03", "exam", 20, 8), // recent half: 40%
        ],
      },
      NOW
    );
    expect(r.trendDeltaPct).toBe(-10);
    expect(r.reasons).toContain("declining_trend");
  });

  it("stays neutral when either trend half is too thin", () => {
    const r = memberReadiness(
      {
        ...base,
        weekly: [
          week("2026-06-29", "exam", 5, 1), // prior half below the minimum
          week("2026-08-03", "exam", 20, 16),
        ],
      },
      NOW
    );
    expect(r.trendDeltaPct).toBeNull();
    expect(r.reasons).not.toContain("declining_trend");
  });

  it("computes coverage over the exam roster, excluding empty subjects", () => {
    const r = memberReadiness(
      {
        ...base,
        subjects: [
          { subjectId: "a", questionCount: 10, attempts: 5, accuracyPct: 50 }, // covered
          { subjectId: "b", questionCount: 10, attempts: 0, accuracyPct: null }, // untouched
          { subjectId: "c", questionCount: 0, attempts: 0, accuracyPct: null }, // no questions — excluded
          { subjectId: "d", questionCount: 10, attempts: 10, accuracyPct: 40 }, // weak despite volume
        ],
      },
      NOW
    );
    expect(r.coveragePct).toBe(33); // 1 of 3 rostered
    expect(r.reasons).toContain("low_coverage");
  });

  it("flags a stopped cadence and rewards a steady one", () => {
    const steady = memberReadiness(base, NOW);
    const stopped = memberReadiness(
      // All activity sits in the PRIOR half; recent 4 weeks are silent.
      { ...base, weeklyActiveDays: [{ weekStart: "2026-06-29", days: 12 }] },
      NOW
    );
    expect(steady.reasons).not.toContain("uneven_cadence");
    expect(stopped.reasons).toContain("uneven_cadence");
  });

  it("returns insufficient_data with a null score below the evidence floor", () => {
    const r = memberReadiness(
      {
        ...base,
        weekly: [week("2026-08-03", "exam", 10, 8)],
        allTime: { attempts: 15, correct: 12 },
      },
      NOW
    );
    expect(r.band).toBe("insufficient_data");
    expect(r.score).toBeNull();
    expect(r.reasons).toContain("insufficient_attempts");
    expect(r.reasons).not.toContain("joined_recently"); // joined in June
  });

  it("adds joined_recently for a fresh member with thin evidence", () => {
    const r = memberReadiness(
      {
        ...base,
        weekly: [],
        allTime: { attempts: 0, correct: 0 },
        joinedAt: "2026-08-05T00:00:00Z",
      },
      NOW
    );
    expect(r.band).toBe("insufficient_data");
    expect(r.reasons).toEqual(["insufficient_attempts", "joined_recently"]);
  });

  it("emits one sparkline entry per window week, oldest first", () => {
    const r = memberReadiness(base, NOW);
    expect(r.weeklyAccuracy).toHaveLength(8);
    expect(r.weeklyAccuracy[0]).toEqual({
      weekStart: "2026-06-22",
      accuracyPct: null,
    });
    expect(r.weeklyAccuracy[6]).toEqual({
      weekStart: "2026-08-03",
      accuracyPct: 80,
    });
  });
});

describe("sittingFraming", () => {
  it("frames upcoming, day-of, passed and unset sittings", () => {
    expect(sittingFraming("2026-09-13", NOW)).toEqual({
      kind: "upcoming",
      daysRemaining: 31,
    });
    expect(sittingFraming("2026-08-13", NOW)).toEqual({
      kind: "upcoming",
      daysRemaining: 0,
    });
    expect(sittingFraming("2026-08-12", NOW)).toEqual({ kind: "passed" });
    expect(sittingFraming(null, NOW)).toBeNull();
  });
});

describe("readinessCsv", () => {
  it("escapes RFC-4180 specials and joins reasons", () => {
    const csv = readinessCsv([
      {
        name: 'Nurse "Quotes", Jane\nMD',
        email: "jane@x.org",
        department: null,
        readiness: {
          score: 74,
          band: "borderline",
          reasons: ["no_timed_practice", "low_coverage"],
          accuracyPct: 71,
          trendDeltaPct: -3,
          coveragePct: 40,
        },
        lastActiveDay: "2026-08-12",
        assignmentsCompleted: 2,
        planAdherencePct: 75,
        hasActivePlan: true,
      },
    ]);
    const [header, row] = csv.split("\n", 2);
    expect(header).toBe(
      "name,email,department,score,band,reasons,accuracy_pct,trend_delta_pct,coverage_pct,last_active,assignments_completed,plan_adherence_pct,has_active_plan"
    );
    expect(csv).toContain("75,yes");
    expect(row).toContain('"Nurse ""Quotes"", Jane'); // quoted, quotes doubled
    expect(csv).toContain("no_timed_practice; low_coverage");
  });
});

describe("countsTowardDeptAssignment", () => {
  const ER = "d0000000-0000-0000-0000-000000000001";
  const CARDIO = "d0000000-0000-0000-0000-000000000002";
  const DUE = "2026-08-20T12:00:00Z";
  const erAssignment = { department_id: ER, due_at: DUE };
  const inEr = (changedAt: string | null) => ({
    department_id: ER,
    department_changed_at: changedAt,
  });

  it("counts a member assigned to the department before the deadline", () => {
    expect(
      countsTowardDeptAssignment(inEr("2026-08-10T12:00:00Z"), erAssignment)
    ).toBe(true);
  });

  it("never marks a late joiner — strict at exactly the due date", () => {
    expect(countsTowardDeptAssignment(inEr(DUE), erAssignment)).toBe(false);
    expect(
      countsTowardDeptAssignment(inEr("2026-08-21T12:00:00Z"), erAssignment)
    ).toBe(false);
  });

  it("drops transfers-out and the unassigned", () => {
    expect(
      countsTowardDeptAssignment(
        { department_id: CARDIO, department_changed_at: "2026-08-10T12:00:00Z" },
        erAssignment
      )
    ).toBe(false);
    expect(
      countsTowardDeptAssignment(
        { department_id: null, department_changed_at: null },
        erAssignment
      )
    ).toBe(false);
  });

  it("gives a deleted department an empty cohort — even for null members", () => {
    const deleted = { department_id: null, due_at: DUE };
    expect(countsTowardDeptAssignment(inEr("2026-08-10T12:00:00Z"), deleted)).toBe(
      false
    );
    // null must not match null — unassigned members are not "in" a deleted dept.
    expect(
      countsTowardDeptAssignment(
        { department_id: null, department_changed_at: null },
        deleted
      )
    ).toBe(false);
  });

  it("counts a member with no timestamp — they ARE in the department", () => {
    expect(countsTowardDeptAssignment(inEr(null), erAssignment)).toBe(true);
  });
});

describe("orgHeadline", () => {
  const row = (over: {
    band?: "on_track" | "borderline" | "at_risk" | "insufficient_data";
    score?: number | null;
    accuracyPct?: number | null;
    lastActiveDay?: string | null;
  }) => ({
    readiness: {
      band: over.band ?? "on_track",
      score: over.score ?? null,
      accuracyPct: over.accuracyPct ?? null,
    },
    lastActiveDay: over.lastActiveDay ?? null,
  });

  it("averages accuracy and readiness over members who have them", () => {
    const headline = orgHeadline(
      [
        row({ accuracyPct: 80, score: 90 }),
        row({ accuracyPct: 61, score: 60 }),
        row({ band: "insufficient_data" }), // null score AND accuracy — excluded
      ],
      NOW
    );
    expect(headline.members).toBe(3);
    expect(headline.averageAccuracy).toBe(71); // 70.5 rounds up
    expect(headline.avgReadiness).toBe(75);
  });

  it("reports nulls for an org with no attempts at all", () => {
    expect(orgHeadline([], NOW)).toEqual({
      members: 0,
      activeThisWeek: 0,
      atRisk: 0,
      averageAccuracy: null,
      avgReadiness: null,
    });
  });

  it("counts this-week activity inclusively at the 7-day day-stamp", () => {
    // NOW is 08-13T12:00Z; the cutoff day stamp is 08-06.
    const headline = orgHeadline(
      [
        row({ lastActiveDay: "2026-08-06" }), // on the boundary — counts
        row({ lastActiveDay: "2026-08-05" }), // past it — does not
        row({ lastActiveDay: null }),
      ],
      NOW
    );
    expect(headline.activeThisWeek).toBe(1);
  });

  it("counts only the at_risk band — insufficient data is not at risk", () => {
    expect(
      orgHeadline(
        [
          row({ band: "at_risk", score: 30 }),
          row({ band: "at_risk", score: 40 }),
          row({ band: "insufficient_data" }),
          row({ band: "borderline", score: 60 }),
        ],
        NOW
      ).atRisk
    ).toBe(2);
  });
});

describe("departmentSummaries", () => {
  const ER = "d0000000-0000-0000-0000-000000000001";
  const CARDIO = "d0000000-0000-0000-0000-000000000002";
  const depts = [
    { id: ER, name: "ER" },
    { id: CARDIO, name: "Cardiology" },
  ];
  const bands = (over: Partial<Record<string, number>> = {}) => ({
    on_track: 0,
    borderline: 0,
    at_risk: 0,
    insufficient_data: 0,
    ...over,
  });
  const member = (
    departmentId: string | null,
    band:
      | "on_track"
      | "borderline"
      | "at_risk"
      | "insufficient_data" = "on_track",
    score: number | null = null
  ) => ({
    member: { department_id: departmentId },
    readiness: { band, score, accuracyPct: null },
    lastActiveDay: null,
  });

  it("summarizes each department in order, Unassigned trailing", () => {
    const summaries = departmentSummaries(depts, [
      member(ER, "on_track", 80),
      member(ER, "at_risk", 40),
      member(CARDIO, "on_track", 90),
      member(null, "insufficient_data"),
    ]);
    expect(summaries).toEqual([
      {
        id: ER,
        name: "ER",
        members: 2,
        avgReadiness: 60,
        bands: bands({ on_track: 1, at_risk: 1 }),
      },
      {
        id: CARDIO,
        name: "Cardiology",
        members: 1,
        avgReadiness: 90,
        bands: bands({ on_track: 1 }),
      },
      {
        id: null,
        name: "Unassigned",
        members: 1,
        avgReadiness: null,
        bands: bands({ insufficient_data: 1 }),
      },
    ]);
  });

  it("keeps an empty department visible — the admin created it", () => {
    const summaries = departmentSummaries(depts, [member(ER, "on_track", 75)]);
    expect(summaries[1]).toEqual({
      id: CARDIO,
      name: "Cardiology",
      members: 0,
      avgReadiness: null,
      bands: bands(),
    });
  });

  it("hides Unassigned once everyone is sorted", () => {
    const summaries = departmentSummaries(depts, [member(ER), member(CARDIO)]);
    expect(summaries.some((s) => s.id === null)).toBe(false);
  });

  it("ignores null scores in the readiness average", () => {
    const [er] = departmentSummaries(
      [depts[0]],
      [member(ER, "at_risk", 40), member(ER, "insufficient_data", null)]
    );
    expect(er.avgReadiness).toBe(40);
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
