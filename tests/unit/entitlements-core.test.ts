import { describe, expect, it } from "vitest";
import {
  accessEndsByExam,
  activePeriodEndForExamPure,
  canAccessExam,
  examAccessFor,
  expiryWarnings,
  type ExamAccess,
  type SubscriptionScope,
} from "@/lib/entitlements-core";

// The seed exam id is not RFC-v4 — kept here so the fixtures match reality.
const EXAM_A = "e0000000-0000-0000-0000-000000000001";
const EXAM_B = "e0000000-0000-0000-0000-000000000002";

const NOW = new Date("2026-07-23T12:00:00Z");
const FUTURE = "2026-10-01T12:00:00Z";
const LATER = "2026-12-01T12:00:00Z";
const PAST = "2026-07-01T12:00:00Z";

const sub = (
  examId: string | null,
  end: string,
  status: SubscriptionScope["status"] = "active"
): SubscriptionScope => ({
  exam_id: examId,
  status,
  current_period_end: end,
});

describe("examAccessFor", () => {
  it("gives admins every exam, with or without subscriptions", () => {
    expect(examAccessFor("admin", [], NOW)).toEqual({
      kind: "all",
      reason: "admin",
    });
  });

  it("gives trial users every exam — the quota is their limiter", () => {
    expect(examAccessFor("trial", [], NOW)).toEqual({
      kind: "all",
      reason: "trial",
    });
  });

  it("does not narrow a trial user who has bought a single exam", () => {
    // Role sync may not have run yet; buying must never REMOVE access.
    expect(examAccessFor("trial", [sub(EXAM_A, FUTURE)], NOW)).toEqual({
      kind: "all",
      reason: "trial",
    });
  });

  it("treats a live null-exam row as grandfathered all-access", () => {
    expect(examAccessFor("student", [sub(null, FUTURE)], NOW)).toEqual({
      kind: "all",
      reason: "legacy",
    });
  });

  it("does not grandfather a lapsed null-exam row", () => {
    expect(examAccessFor("student", [sub(null, PAST)], NOW)).toEqual({
      kind: "none",
    });
  });

  it("lists every exam a student holds live access to", () => {
    const access = examAccessFor(
      "student",
      [sub(EXAM_A, FUTURE), sub(EXAM_B, LATER)],
      NOW
    );
    expect(access).toEqual({ kind: "scoped", examIds: [EXAM_A, EXAM_B] });
  });

  it("dedupes stacked rows for the same exam", () => {
    expect(
      examAccessFor("student", [sub(EXAM_A, FUTURE), sub(EXAM_A, LATER)], NOW)
    ).toEqual({ kind: "scoped", examIds: [EXAM_A] });
  });

  it("ignores cancelled and expired rows with future end dates", () => {
    expect(
      examAccessFor(
        "student",
        [sub(EXAM_A, FUTURE, "cancelled"), sub(EXAM_B, LATER, "expired")],
        NOW
      )
    ).toEqual({ kind: "none" });
  });

  it("gives a student with no live row nothing", () => {
    // The intentional behaviour change: role is not a second source of truth.
    expect(examAccessFor("student", [sub(EXAM_A, PAST)], NOW)).toEqual({
      kind: "none",
    });
  });
});

describe("canAccessExam", () => {
  it("passes everything for all-access", () => {
    expect(
      canAccessExam({ kind: "all", reason: "trial" }, EXAM_A)
    ).toBe(true);
  });

  it("passes only named exams when scoped", () => {
    const access: ExamAccess = { kind: "scoped", examIds: [EXAM_A] };
    expect(canAccessExam(access, EXAM_A)).toBe(true);
    expect(canAccessExam(access, EXAM_B)).toBe(false);
  });

  it("blocks everything when there is no access", () => {
    expect(canAccessExam({ kind: "none" }, EXAM_A)).toBe(false);
  });
});

describe("activePeriodEndForExamPure", () => {
  it("picks the latest live row for the same exam", () => {
    expect(
      activePeriodEndForExamPure(
        [sub(EXAM_A, FUTURE), sub(EXAM_A, LATER)],
        EXAM_A,
        NOW
      )
    ).toBe(LATER);
  });

  it("does not let an all-access row extend a scoped purchase", () => {
    expect(
      activePeriodEndForExamPure([sub(null, LATER)], EXAM_A, NOW)
    ).toBeNull();
  });

  it("does not let a scoped row extend an all-access grant", () => {
    expect(
      activePeriodEndForExamPure([sub(EXAM_A, LATER)], null, NOW)
    ).toBeNull();
  });

  it("matches all-access rows to the all-access key", () => {
    expect(activePeriodEndForExamPure([sub(null, LATER)], null, NOW)).toBe(
      LATER
    );
  });

  it("returns null for an exam with no live access", () => {
    expect(
      activePeriodEndForExamPure([sub(EXAM_A, PAST)], EXAM_A, NOW)
    ).toBeNull();
  });
});

describe("accessEndsByExam", () => {
  it("keeps one entry per exam, latest end winning", () => {
    const ends = accessEndsByExam(
      [sub(EXAM_A, FUTURE), sub(EXAM_A, LATER), sub(EXAM_B, FUTURE)],
      NOW
    );
    expect(ends.get(EXAM_A)).toBe(LATER);
    expect(ends.get(EXAM_B)).toBe(FUTURE);
  });

  it("keys all-access rows under null", () => {
    const ends = accessEndsByExam([sub(null, FUTURE)], NOW);
    expect(ends.get(null)).toBe(FUTURE);
  });

  it("skips rows that are not effectively active", () => {
    expect(accessEndsByExam([sub(EXAM_A, PAST)], NOW).size).toBe(0);
  });
});

describe("expiryWarnings", () => {
  const SOON = "2026-07-26T12:00:00Z"; // 3 days out
  const SOONER = "2026-07-24T12:00:00Z"; // 1 day out

  it("stays silent when nothing ends within the window", () => {
    expect(expiryWarnings([sub(EXAM_A, FUTURE)], NOW)).toEqual([]);
  });

  it("warns per exam, soonest first", () => {
    const warnings = expiryWarnings(
      [sub(EXAM_A, SOON), sub(EXAM_B, SOONER)],
      NOW
    );
    expect(warnings).toEqual([
      { examId: EXAM_B, periodEnd: SOONER, daysLeft: 1 },
      { examId: EXAM_A, periodEnd: SOON, daysLeft: 3 },
    ]);
  });

  it("warns about one exam even while another runs for months", () => {
    // The regression the old global expiryWarning had: it took the max end
    // across every row, so this case reported nothing at all.
    const warnings = expiryWarnings(
      [sub(EXAM_A, SOON), sub(EXAM_B, LATER)],
      NOW
    );
    expect(warnings).toEqual([
      { examId: EXAM_A, periodEnd: SOON, daysLeft: 3 },
    ]);
  });

  it("lets a stacked repurchase of the SAME exam suppress the warning", () => {
    expect(expiryWarnings([sub(EXAM_A, SOON), sub(EXAM_A, LATER)], NOW)).toEqual(
      []
    );
  });

  it("fires at the 7-day boundary and stays silent past it", () => {
    expect(expiryWarnings([sub(EXAM_A, "2026-07-30T11:00:00Z")], NOW)).toEqual([
      { examId: EXAM_A, periodEnd: "2026-07-30T11:00:00Z", daysLeft: 7 },
    ]);
    expect(expiryWarnings([sub(EXAM_A, "2026-07-30T13:00:00Z")], NOW)).toEqual(
      []
    );
  });

  it("stays silent once access has lapsed", () => {
    expect(expiryWarnings([sub(EXAM_A, PAST)], NOW)).toEqual([]);
  });
});
