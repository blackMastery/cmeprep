/**
 * Pure org rules: the grace/lock state machine, seat math and invite
 * validity (SPEC.md §3–§5).
 *
 * Pure so vitest can exercise every branch — the DB-touching org layer is
 * lib/orgs.ts. The stale-'active' subscription rule is NOT restated here;
 * grace is layered on top of isEffectivelyActive from subscriptions-core.
 */

import {
  daysUntil,
  EXPIRY_WARNING_DAYS,
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
 * Does ONE subscription row grant right now? Effectively active, or an
 * 'active'-status row still inside its 14-day grace. This is the per-row
 * predicate the entitlement rider (lib/entitlements-core.ts) uses to decide
 * WHICH exams an org's rows entitle — stated once, here, next to the state
 * machine built from it.
 */
export function orgSubGrants(sub: SubscriptionLike, now: Date): boolean {
  return (
    isEffectivelyActive(sub, now) ||
    (sub.status === "active" && now < orgGraceEnd(sub.current_period_end))
  );
}

/**
 * State across ALL of an org's subscription rows: any effectively-active row
 * keeps the org "active" (renewals stack, so old lapsed rows linger); failing
 * that, a row still granting through its grace window yields "grace".
 */
export function orgSubscriptionState(
  subs: readonly SubscriptionLike[],
  now: Date
): OrgSubscriptionState {
  let state: OrgSubscriptionState = "locked";
  for (const sub of subs) {
    if (isEffectivelyActive(sub, now)) return "active";
    if (orgSubGrants(sub, now)) state = "grace";
  }
  return state;
}

export type OrgExamAlert = {
  examId: string;
  /** When access to this exam actually ends (grace end for lapsed rows). */
  endsAt: string;
  state: "expiring" | "grace";
};

/**
 * Per-EXAM trouble the org-wide state machine cannot see: with purchases
 * scoped per exam, exam A can lapse into grace while exam B keeps the org
 * "active" — and nobody would be warned. One alert per exam whose latest
 * paid period ends within EXPIRY_WARNING_DAYS ("expiring") or has ended but
 * is still inside its 14-day grace ("grace"), soonest first. Comp all-access
 * rows (exam_id null) are excluded — the org-wide banner owns those.
 */
export function orgExamAlerts(
  subs: readonly (SubscriptionLike & { exam_id: string | null })[],
  now: Date
): OrgExamAlert[] {
  const latestByExam = new Map<string, string>();
  for (const sub of subs) {
    if (sub.status !== "active" || sub.exam_id === null) continue;
    const prev = latestByExam.get(sub.exam_id);
    if (!prev || new Date(sub.current_period_end) > new Date(prev)) {
      latestByExam.set(sub.exam_id, sub.current_period_end);
    }
  }

  const alerts: OrgExamAlert[] = [];
  for (const [examId, end] of latestByExam) {
    if (new Date(end) > now) {
      const days = daysUntil(end, now);
      if (days >= 1 && days <= EXPIRY_WARNING_DAYS) {
        alerts.push({ examId, endsAt: end, state: "expiring" });
      }
    } else if (now < orgGraceEnd(end)) {
      alerts.push({
        examId,
        endsAt: orgGraceEnd(end).toISOString(),
        state: "grace",
      });
    }
  }
  return alerts.sort((a, b) => a.endsAt.localeCompare(b.endsAt));
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
/* ── Exam readiness (SPEC §8 v2) ─────────────────────────────────
 *
 * A fixed, product-owned formula — deterministic and explainable, because
 * there is no ground-truth pass/fail data to fit anything against. The org's
 * only inputs are its pass mark, inactivity window and (framing only) a
 * sitting date. All constants live here so vitest pins every branch.
 */

/** 8 ISO weeks of evidence: trend compares the recent 4 against the prior 4. */
export const READINESS_WEEKS = 8;
/** Below this many attempts (window AND all-time) there is no reading. */
export const READINESS_MIN_ATTEMPTS = 20;
/** Timed exam-mode attempts count double in the blended accuracy — tutor
 * accuracy is inflated by instant feedback and no clock. */
export const EXAM_MODE_WEIGHT = 2;
export const READINESS_WEIGHTS = {
  accuracy: 0.5,
  trend: 0.15,
  coverage: 0.2,
  cadence: 0.15,
} as const;
export const BAND_ON_TRACK_MIN = 75;
export const BAND_BORDERLINE_MIN = 55;
/** Caps sit one point below on_track: you cannot look ready without a recent
 * timed mock, or while dormant — however good the other signals are. */
export const READINESS_CAP = BAND_ON_TRACK_MIN - 1;
/** Mirrors the member dashboard's weak-areas floor (gte attempts 5). */
export const COVERAGE_MIN_SUBJECT_ATTEMPTS = 5;
/** Mirrors ACCURACY_WEAK in lib/format.ts. */
export const COVERAGE_WEAK_PCT = 50;
/** ~3 active days a week over the recent 4 weeks. */
export const CADENCE_TARGET_DAYS = 12;
/** Accuracy drop (recent 4w vs prior 4w) that earns declining_trend. */
export const TREND_DROP_PCT = 5;
export const JOINED_RECENTLY_DAYS = 14;
/** A trend half needs this many attempts before its accuracy means much. */
export const TREND_MIN_HALF_ATTEMPTS = 10;

export type ReadinessBand =
  | "on_track"
  | "borderline"
  | "at_risk"
  | "insufficient_data";

export type ReadinessReason =
  // Legacy v1 reasons, folded in — still the two most explainable.
  | "below_pass_mark"
  | "inactive"
  // The hard cap (decision: no timed mock ⇒ never on_track).
  | "no_timed_practice"
  | "declining_trend"
  | "low_coverage"
  | "uneven_cadence"
  // insufficient_data band only:
  | "insufficient_attempts"
  | "joined_recently";

export type WeeklyModeBucket = {
  /** Monday of the ISO week (YYYY-MM-DD, America/Guyana). */
  weekStart: string;
  /** OSCE buckets weigh like tutor in the blend — only timed exam-mode work
   * gets EXAM_MODE_WEIGHT. */
  mode: "exam" | "tutor" | "osce";
  attempts: number;
  correct: number;
};

export type MemberReadinessInput = {
  passMarkPct: number;
  inactivityDays: number;
  /** Window rows only (week_start >= readinessWindowStart). */
  weekly: WeeklyModeBucket[];
  weeklyActiveDays: { weekStart: string; days: number }[];
  /** Per-exam all-time totals — the cold-start fallback. */
  allTime: { attempts: number; correct: number };
  /** FULL exam subject roster, untouched subjects included (zero-filled). */
  subjects: {
    subjectId: string;
    questionCount: number;
    attempts: number;
    accuracyPct: number | null;
  }[];
  /** ≥1 submitted exam-mode test in the window. Keyed off tests rows, not
   * attempts — legacy null-test_id attempts count as exam-mode in the views
   * but deliberately cannot satisfy this. */
  hasExamModeTestInWindow: boolean;
  /** Per-exam most recent activity date (YYYY-MM-DD); null = never. */
  lastActiveDay: string | null;
  joinedAt: string;
};

export type MemberReadiness = {
  band: ReadinessBand;
  /** Null exactly when band is insufficient_data — never a fake-precise
   * number over thin evidence. */
  score: number | null;
  reasons: ReadinessReason[];
  /** The blended figure the pass-mark check used; null = no attempts. */
  accuracyPct: number | null;
  /** Recent-4-weeks minus prior-4-weeks accuracy; null = no prior evidence. */
  trendDeltaPct: number | null;
  /** % of the exam's subjects covered (≥5 attempts, ≥50%); null = no roster. */
  coveragePct: number | null;
  /** One entry per window week, oldest first; null = no attempts that week.
   * This is the sparkline series. */
  weeklyAccuracy: { weekStart: string; accuracyPct: number | null }[];
};

/** Civil date (YYYY-MM-DD) of a moment in America/Guyana — the app's
 * analytics timezone (user_daily_activity precedent). */
export function guyanaDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guyana",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Civil-date arithmetic (YYYY-MM-DD, UTC math on the day string) — stated
 * once next to mondayOf so every consumer of the week contract shares it. */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `b` to `a` (a − b). */
export function dayDiff(a: string, b: string): number {
  return (
    (new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) /
    DAY_MS
  );
}

/** Monday of the ISO week containing a civil date — MUST agree with the
 * views' `date_trunc('week', … at time zone 'America/Guyana')` or the
 * week_start >= filter clips a partial week. Views bound by this contract:
 * the readiness views (20260817000001) and the study-plan views
 * (20260820000001, user_exam_week_test_subject_attempts). */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** The window's oldest week_start: current week plus 7 before it. */
export function readinessWindowStart(now: Date): string {
  const currentMonday = new Date(`${mondayOf(guyanaDay(now))}T00:00:00Z`);
  currentMonday.setUTCDate(
    currentMonday.getUTCDate() - (READINESS_WEEKS - 1) * 7
  );
  return currentMonday.toISOString().slice(0, 10);
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

const pct = (correct: number, attempts: number): number | null =>
  attempts > 0 ? Math.round((correct / attempts) * 100) : null;

/**
 * The readiness score (SPEC §8 v2). Four weighted sub-scores (0–100 each) —
 * blended accuracy vs the org pass mark, trend, subject coverage, cadence —
 * then two caps that keep the score below on_track: no timed mock in the
 * window, or inactive per the org's window. Thin evidence gets the honest
 * insufficient_data band with a null score, never a number.
 */
export function memberReadiness(
  input: MemberReadinessInput,
  now: Date
): MemberReadiness {
  const currentMonday = mondayOf(guyanaDay(now));
  const weekStarts: string[] = [];
  for (let i = READINESS_WEEKS - 1; i >= 0; i--) {
    const d = new Date(`${currentMonday}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i * 7);
    weekStarts.push(d.toISOString().slice(0, 10));
  }
  // The recent half is the newest 4 weeks (current partial week included).
  const recentCutoff = weekStarts[READINESS_WEEKS / 2];

  // ── Sparkline series (all modes combined, every window week present)
  const byWeek = new Map<string, { attempts: number; correct: number }>();
  for (const b of input.weekly) {
    const agg = byWeek.get(b.weekStart) ?? { attempts: 0, correct: 0 };
    agg.attempts += b.attempts;
    agg.correct += b.correct;
    byWeek.set(b.weekStart, agg);
  }
  const weeklyAccuracy = weekStarts.map((weekStart) => {
    const agg = byWeek.get(weekStart);
    return { weekStart, accuracyPct: agg ? pct(agg.correct, agg.attempts) : null };
  });

  // ── Blended accuracy (exam-mode attempts count double)
  const windowAttempts = input.weekly.reduce((sum, b) => sum + b.attempts, 0);
  let accuracyPct: number | null;
  if (windowAttempts >= READINESS_MIN_ATTEMPTS) {
    let wAttempts = 0;
    let wCorrect = 0;
    for (const b of input.weekly) {
      const w = b.mode === "exam" ? EXAM_MODE_WEIGHT : 1;
      wAttempts += b.attempts * w;
      wCorrect += b.correct * w;
    }
    accuracyPct = pct(wCorrect, wAttempts);
  } else if (input.allTime.attempts >= READINESS_MIN_ATTEMPTS) {
    // Dormant fallback: last computable figure (no mode split all-time).
    accuracyPct = pct(input.allTime.correct, input.allTime.attempts);
  } else {
    // Not enough evidence anywhere — say so, don't score.
    const reasons: ReadinessReason[] = ["insufficient_attempts"];
    if (now.getTime() - new Date(input.joinedAt).getTime() <
        JOINED_RECENTLY_DAYS * DAY_MS) {
      reasons.push("joined_recently");
    }
    return {
      band: "insufficient_data",
      score: null,
      reasons,
      accuracyPct: pct(input.allTime.correct, input.allTime.attempts),
      trendDeltaPct: null,
      coveragePct: null,
      weeklyAccuracy,
    };
  }
  // accuracy == passMark is NOT below — the mark is "what passes" (v1 rule).
  const accuracySub =
    accuracyPct === null
      ? 50
      : clamp(50 + (accuracyPct - input.passMarkPct) * 2.5, 0, 100);

  // ── Trend: recent 4 ISO weeks vs the prior 4 (modes combined)
  const half = { recent: { a: 0, c: 0 }, prior: { a: 0, c: 0 } };
  for (const b of input.weekly) {
    const side = b.weekStart >= recentCutoff ? half.recent : half.prior;
    side.a += b.attempts;
    side.c += b.correct;
  }
  let trendDeltaPct: number | null = null;
  if (
    half.recent.a >= TREND_MIN_HALF_ATTEMPTS &&
    half.prior.a >= TREND_MIN_HALF_ATTEMPTS
  ) {
    trendDeltaPct = pct(half.recent.c, half.recent.a)! - pct(half.prior.c, half.prior.a)!;
  }
  const trendSub =
    trendDeltaPct === null ? 50 : 50 + clamp(trendDeltaPct, -20, 20) * 2.5;

  // ── Coverage: subjects of the exam that are both practised and not weak
  const rostered = input.subjects.filter((s) => s.questionCount > 0);
  let coveragePct: number | null = null;
  if (rostered.length > 0) {
    const covered = rostered.filter(
      (s) =>
        s.attempts >= COVERAGE_MIN_SUBJECT_ATTEMPTS &&
        (s.accuracyPct ?? 0) >= COVERAGE_WEAK_PCT
    ).length;
    coveragePct = Math.round((covered / rostered.length) * 100);
  }
  const coverageSub = coveragePct ?? 50;

  // ── Cadence: active days across the recent 4 weeks vs the target
  const activeDays = input.weeklyActiveDays
    .filter((w) => w.weekStart >= recentCutoff)
    .reduce((sum, w) => sum + w.days, 0);
  const cadenceSub = Math.round(
    clamp((activeDays / CADENCE_TARGET_DAYS) * 100, 0, 100)
  );

  let score = Math.round(
    READINESS_WEIGHTS.accuracy * accuracySub +
      READINESS_WEIGHTS.trend * trendSub +
      READINESS_WEIGHTS.coverage * coverageSub +
      READINESS_WEIGHTS.cadence * cadenceSub
  );

  // ── Caps + reasons (cap reasons first — they explain the band)
  const reasons: ReadinessReason[] = [];
  if (!input.hasExamModeTestInWindow) {
    score = Math.min(score, READINESS_CAP);
    reasons.push("no_timed_practice");
  }
  const inactive =
    input.lastActiveDay === null ||
    now.getTime() - new Date(`${input.lastActiveDay}T00:00:00Z`).getTime() >
      input.inactivityDays * DAY_MS;
  if (inactive) {
    score = Math.min(score, READINESS_CAP);
    reasons.push("inactive");
  }
  if (accuracyPct !== null && accuracyPct < input.passMarkPct) {
    reasons.push("below_pass_mark");
  }
  if (trendDeltaPct !== null && trendDeltaPct <= -TREND_DROP_PCT) {
    reasons.push("declining_trend");
  }
  if (coverageSub < 50) reasons.push("low_coverage");
  if (cadenceSub < 50) reasons.push("uneven_cadence");

  const band: ReadinessBand =
    score >= BAND_ON_TRACK_MIN
      ? "on_track"
      : score >= BAND_BORDERLINE_MIN
        ? "borderline"
        : "at_risk";

  return {
    band,
    score,
    reasons,
    accuracyPct,
    trendDeltaPct,
    coveragePct,
    weeklyAccuracy,
  };
}

export type SittingFraming =
  | { kind: "upcoming"; daysRemaining: number }
  | { kind: "passed" };

/**
 * How to FRAME a readiness reading against the org's sitting date — copy and
 * sort priority only; the score and bands never move with the calendar.
 */
export function sittingFraming(
  sittingOn: string | null,
  now: Date
): SittingFraming | null {
  if (sittingOn === null) return null;
  const days = Math.round(
    (new Date(`${sittingOn}T00:00:00Z`).getTime() -
      new Date(`${guyanaDay(now)}T00:00:00Z`).getTime()) /
      DAY_MS
  );
  return days >= 0 ? { kind: "upcoming", daysRemaining: days } : { kind: "passed" };
}

/** RFC 4180: quote when needed, double embedded quotes. */
function csvField(value: string | number | null): string {
  const s = value === null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** The org readiness table as CSV, for program directors who report upward. */
export function readinessCsv(
  rows: readonly {
    name: string | null;
    email: string | null;
    department: string | null;
    readiness: Pick<
      MemberReadiness,
      "score" | "band" | "reasons" | "accuracyPct" | "trendDeltaPct" | "coveragePct"
    >;
    lastActiveDay: string | null;
    assignmentsCompleted: number;
    /** Study-plan visibility (SPEC §17): the derived pair is all the org
     * export ever carries — goals/intensity/personal dates stay private. */
    planAdherencePct: number | null;
    hasActivePlan: boolean;
  }[]
): string {
  const header = [
    "name", "email", "department", "score", "band", "reasons",
    "accuracy_pct", "trend_delta_pct", "coverage_pct",
    "last_active", "assignments_completed",
    "plan_adherence_pct", "has_active_plan",
  ].join(",");
  const lines = rows.map((r) =>
    [
      csvField(r.name),
      csvField(r.email),
      csvField(r.department),
      csvField(r.readiness.score),
      csvField(r.readiness.band),
      csvField(r.readiness.reasons.join("; ")),
      csvField(r.readiness.accuracyPct),
      csvField(r.readiness.trendDeltaPct),
      csvField(r.readiness.coveragePct),
      csvField(r.lastActiveDay),
      csvField(r.assignmentsCompleted),
      csvField(r.planAdherencePct),
      csvField(r.hasActivePlan ? "yes" : "no"),
    ].join(",")
  );
  return [header, ...lines].join("\n");
}

export type AssignmentStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "completed_late"
  | "overdue";

/**
 * Does this test satisfy the assignment it was launched from (SPEC §7)?
 *
 * Exam mode: any submitted attempt, as always. Tutor mode: submitted AND
 * every question answered — tutor scoring is correct/ANSWERED, so without
 * the 100%-answered bar a member could check 3 easy questions of a 40-
 * question assignment, finish at 100%, and read as done on the org report.
 * Used by both the member's own standing (assignmentsForMember) and admin
 * completion counts (listAssignmentProgress) so one rule decides.
 */
export function qualifiesAsAssignmentCompletion(test: {
  /** 'osce' can't launch from an assignment today; accepted (and held to the
   * tutor bar) so the type matches any tests row without a cast. */
  mode: "exam" | "tutor" | "osce";
  status: string;
  answered_questions: number | null;
  total_questions: number;
}): boolean {
  if (test.status !== "submitted") return false;
  if (test.mode === "exam") return true;
  return (test.answered_questions ?? 0) >= test.total_questions;
}

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

/** App-side cap, like seat limits — the table has no SQL count constraint. */
export const MAX_ORG_DEPARTMENTS = 50;

/**
 * Is this member in a department assignment's completion cohort?
 *
 * Department audiences are DYNAMIC — no target rows exist — so the cohort is
 * "current department members who were assigned to the department before the
 * deadline". Strict `<` on the timestamp: someone moved in AT or after the
 * due date never saw the assignment in time and must not read as late.
 * Transfers-out fail the id match and drop from stats entirely. A deleted
 * department (assignment department_id null) has an empty cohort. A null
 * changed_at with a live department shouldn't occur (writes always stamp
 * both), but if it does the member counts — they ARE in the department.
 *
 * Used by BOTH member-facing visibility (assignmentsForMember) and admin
 * completion stats (listAssignmentProgress) so one rule decides who an
 * assignment reaches. due_at is NOT NULL in the schema, so there is no
 * "no deadline" branch.
 */
export function countsTowardDeptAssignment(
  member: {
    department_id: string | null;
    department_changed_at: string | null;
  },
  assignment: { department_id: string | null; due_at: string }
): boolean {
  if (assignment.department_id === null) return false;
  if (member.department_id !== assignment.department_id) return false;
  if (member.department_changed_at === null) return true;
  return new Date(member.department_changed_at) < new Date(assignment.due_at);
}

/** Rounded mean over the non-null values; null when none. Stated once —
 * orgHeadline and departmentSummaries must agree on the same numbers. */
export function roundedMean(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0
    ? Math.round(present.reduce((sum, v) => sum + v, 0) / present.length)
    : null;
}

/** The row slice both aggregators consume. */
export type ReadinessRow = {
  readiness: Pick<MemberReadiness, "band" | "score" | "accuracyPct">;
  lastActiveDay: string | null;
};

export type OrgHeadline = {
  members: number;
  activeThisWeek: number;
  /** Count of the at_risk BAND — insufficient_data is not "at risk". */
  atRisk: number;
  averageAccuracy: number | null;
  /** Mean readiness score over members with a score (nulls excluded). */
  avgReadiness: number | null;
};

/**
 * The dashboard's stat cards over any slice of member rows. Extracted
 * from the dashboard loader so the page can recompute the same numbers for
 * a department filter without a second data pass.
 */
export function orgHeadline(
  rows: readonly ReadinessRow[],
  now: Date
): OrgHeadline {
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return {
    members: rows.length,
    activeThisWeek: rows.filter(
      (r) => r.lastActiveDay !== null && r.lastActiveDay >= weekAgo
    ).length,
    atRisk: rows.filter((r) => r.readiness.band === "at_risk").length,
    averageAccuracy: roundedMean(rows.map((r) => r.readiness.accuracyPct)),
    avgReadiness: roundedMean(rows.map((r) => r.readiness.score)),
  };
}

export type DepartmentSummary = {
  /** null = the "Unassigned" pseudo-department. */
  id: string | null;
  name: string;
  members: number;
  avgReadiness: number | null;
  bands: Record<ReadinessBand, number>;
};

/**
 * Comparison-strip aggregation: one entry per real department in the given
 * order — EMPTY ones included, the admin created them and needs to see they
 * are empty — plus a trailing "Unassigned" pseudo-department only while
 * anyone is actually unassigned (permanent once every member is sorted
 * would just be noise).
 */
export function departmentSummaries(
  departments: readonly { id: string; name: string }[],
  rows: readonly (ReadinessRow & {
    member: { department_id: string | null };
  })[]
): DepartmentSummary[] {
  const summarize = (
    id: string | null,
    name: string,
    slice: typeof rows
  ): DepartmentSummary => {
    const bands: Record<ReadinessBand, number> = {
      on_track: 0,
      borderline: 0,
      at_risk: 0,
      insufficient_data: 0,
    };
    for (const r of slice) bands[r.readiness.band]++;
    return {
      id,
      name,
      members: slice.length,
      avgReadiness: roundedMean(slice.map((r) => r.readiness.score)),
      bands,
    };
  };

  const summaries = departments.map((d) =>
    summarize(
      d.id,
      d.name,
      rows.filter((r) => r.member.department_id === d.id)
    )
  );
  const unassigned = rows.filter((r) => r.member.department_id === null);
  if (unassigned.length > 0) {
    summaries.push(summarize(null, "Unassigned", unassigned));
  }
  return summaries;
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
