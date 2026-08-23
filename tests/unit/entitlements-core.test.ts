import { describe, expect, it } from "vitest";
import {
  accessEndsByExam,
  activePeriodEndForExamPure,
  canAccessExam,
  consumesTrialCredit,
  maxQuestionsFor,
  TRIAL_MAX_QUESTIONS,
  examAccessFor,
  expiryWarnings,
  orgAccessOf,
  orgExamAllowed,
  visibleExamsFor,
  type ExamAccess,
  type OrgGrantContext,
  type SubscriptionScope,
} from "@/lib/entitlements-core";

// The seed exam id is not RFC-v4 — kept here so the fixtures match reality.
const EXAM_A = "e0000000-0000-0000-0000-000000000001";
const EXAM_B = "e0000000-0000-0000-0000-000000000002";
const ORG_1 = "a0000000-0000-0000-0000-000000000001";
const ORG_2 = "a0000000-0000-0000-0000-000000000002";

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

/** An org entitled to EXAM_A, unsuspended, unless the fixture says otherwise. */
const org = (over: Partial<OrgGrantContext> = {}): OrgGrantContext => ({
  org_id: ORG_1,
  suspended_at: null,
  subs: [sub(EXAM_A, FUTURE)],
  ...over,
});

const NO_ORG = { org: null };

describe("orgAccessOf", () => {
  it("names exactly the exams the granting rows bought", () => {
    expect(
      orgAccessOf(org({ subs: [sub(EXAM_A, FUTURE), sub(EXAM_B, LATER)] }), NOW)
    ).toEqual({ orgId: ORG_1, examIds: [EXAM_A, EXAM_B], allAccess: false });
  });

  it("dedupes stacked rows and flags a comp null-exam row as allAccess", () => {
    expect(
      orgAccessOf(
        org({ subs: [sub(EXAM_A, FUTURE), sub(EXAM_A, LATER), sub(null, FUTURE)] }),
        NOW
      )
    ).toEqual({ orgId: ORG_1, examIds: [EXAM_A], allAccess: true });
  });

  it("keeps a lapsed exam granting through its 14-day grace", () => {
    const inGrace = org({
      subs: [
        { ...sub(EXAM_A, "2026-07-20T12:00:00Z") }, // lapsed 3 days ago
        sub(EXAM_B, FUTURE),
      ],
    });
    expect(orgAccessOf(inGrace, NOW)?.examIds).toEqual([EXAM_A, EXAM_B]);
  });

  it("drops an exam once its grace runs out while others keep granting", () => {
    const mixed = org({ subs: [sub(EXAM_A, PAST), sub(EXAM_B, FUTURE)] });
    expect(orgAccessOf(mixed, NOW)?.examIds).toEqual([EXAM_B]);
  });

  it("returns null past grace, when suspended, and for non-members", () => {
    expect(orgAccessOf(org({ subs: [sub(EXAM_A, PAST)] }), NOW)).toBeNull();
    expect(orgAccessOf(org({ suspended_at: PAST }), NOW)).toBeNull();
    expect(orgAccessOf(null, NOW)).toBeNull();
  });

  it("gives cancelled rows no grace", () => {
    expect(
      orgAccessOf(org({ subs: [sub(EXAM_A, FUTURE, "cancelled")] }), NOW)
    ).toBeNull();
  });
});

describe("examAccessFor", () => {
  it("gives admins every exam, with or without subscriptions", () => {
    expect(examAccessFor("admin", [], null, NOW)).toEqual({
      kind: "all",
      reason: "admin",
      ...NO_ORG,
    });
  });

  it("gives trial users every exam — the quota is their limiter", () => {
    expect(examAccessFor("trial", [], null, NOW)).toEqual({
      kind: "all",
      reason: "trial",
      ...NO_ORG,
    });
  });

  it("does not narrow a trial user who has bought a single exam", () => {
    // Role sync may not have run yet; buying must never REMOVE access.
    expect(examAccessFor("trial", [sub(EXAM_A, FUTURE)], null, NOW)).toEqual({
      kind: "all",
      reason: "trial",
      ...NO_ORG,
    });
  });

  it("carries the org rider WITHOUT replacing the personal kind", () => {
    // A student member with no personal rows: kind "none" — and entitled.
    // "none" no longer means "no access"; canAccessExam unions the rider in.
    expect(examAccessFor("student", [], org(), NOW)).toEqual({
      kind: "none",
      org: { orgId: ORG_1, examIds: [EXAM_A], allAccess: false },
    });
  });

  it("keeps a trial-role member trial-wide; the rider handles metering", () => {
    expect(examAccessFor("trial", [], org(), NOW)).toEqual({
      kind: "all",
      reason: "trial",
      org: { orgId: ORG_1, examIds: [EXAM_A], allAccess: false },
    });
  });

  it("unions personal scoped rows with the rider rather than choosing", () => {
    const access = examAccessFor("student", [sub(EXAM_B, FUTURE)], org(), NOW);
    expect(access).toEqual({
      kind: "scoped",
      examIds: [EXAM_B],
      org: { orgId: ORG_1, examIds: [EXAM_A], allAccess: false },
    });
    expect(canAccessExam(access, { id: EXAM_A, orgId: null })).toBe(true);
    expect(canAccessExam(access, { id: EXAM_B, orgId: null })).toBe(true);
  });

  it("drops the rider once grace has run out, falling back to personal rows", () => {
    const locked = org({ subs: [sub(EXAM_A, PAST)] });
    expect(
      examAccessFor("student", [sub(EXAM_A, FUTURE)], locked, NOW)
    ).toEqual({ kind: "scoped", examIds: [EXAM_A], ...NO_ORG });
    expect(examAccessFor("student", [], locked, NOW)).toEqual({
      kind: "none",
      ...NO_ORG,
    });
  });

  it("ignores a suspended org regardless of its subscription", () => {
    const suspended = org({ suspended_at: PAST });
    expect(examAccessFor("student", [], suspended, NOW)).toEqual({
      kind: "none",
      ...NO_ORG,
    });
    expect(examAccessFor("trial", [], suspended, NOW)).toEqual({
      kind: "all",
      reason: "trial",
      ...NO_ORG,
    });
  });

  it("treats a live null-exam row as grandfathered all-access", () => {
    expect(examAccessFor("student", [sub(null, FUTURE)], null, NOW)).toEqual({
      kind: "all",
      reason: "legacy",
      ...NO_ORG,
    });
  });

  it("does not grandfather a lapsed null-exam row", () => {
    expect(examAccessFor("student", [sub(null, PAST)], null, NOW)).toEqual({
      kind: "none",
      ...NO_ORG,
    });
  });

  it("lists every exam a student holds live access to", () => {
    const access = examAccessFor(
      "student",
      [sub(EXAM_A, FUTURE), sub(EXAM_B, LATER)],
      null,
      NOW
    );
    expect(access).toEqual({
      kind: "scoped",
      examIds: [EXAM_A, EXAM_B],
      ...NO_ORG,
    });
  });

  it("dedupes stacked rows for the same exam", () => {
    expect(
      examAccessFor(
        "student",
        [sub(EXAM_A, FUTURE), sub(EXAM_A, LATER)],
        null,
        NOW
      )
    ).toEqual({ kind: "scoped", examIds: [EXAM_A], ...NO_ORG });
  });

  it("ignores cancelled and expired rows with future end dates", () => {
    expect(
      examAccessFor(
        "student",
        [sub(EXAM_A, FUTURE, "cancelled"), sub(EXAM_B, LATER, "expired")],
        null,
        NOW
      )
    ).toEqual({ kind: "none", ...NO_ORG });
  });

  it("gives a student with no live row and no org nothing", () => {
    // The intentional behaviour change: role is not a second source of truth.
    expect(examAccessFor("student", [sub(EXAM_A, PAST)], null, NOW)).toEqual({
      kind: "none",
      ...NO_ORG,
    });
  });
});

const RIDER = { orgId: ORG_1, examIds: [EXAM_A], allAccess: false };
const MEMBER_ACCESS: ExamAccess = { kind: "none", org: RIDER };

describe("orgExamAllowed", () => {
  it("lets anyone at a public exam", () => {
    expect(orgExamAllowed({ kind: "none", ...NO_ORG }, null)).toBe(true);
    expect(
      orgExamAllowed({ kind: "all", reason: "trial", ...NO_ORG }, null)
    ).toBe(true);
  });

  it("lets members and platform admins into their org's bank", () => {
    expect(orgExamAllowed(MEMBER_ACCESS, ORG_1)).toBe(true);
    // The bank rides on ANY granting row — which exams were bought is
    // irrelevant to bank access.
    expect(
      orgExamAllowed(
        { kind: "all", reason: "trial", org: RIDER },
        ORG_1
      )
    ).toBe(true);
    expect(
      orgExamAllowed({ kind: "all", reason: "admin", ...NO_ORG }, ORG_1)
    ).toBe(true);
  });

  it("never lets public breadth cross an org wall", () => {
    expect(orgExamAllowed(MEMBER_ACCESS, ORG_2)).toBe(false);
    expect(
      orgExamAllowed({ kind: "all", reason: "trial", ...NO_ORG }, ORG_1)
    ).toBe(false);
    expect(
      orgExamAllowed({ kind: "all", reason: "legacy", ...NO_ORG }, ORG_1)
    ).toBe(false);
  });
});

describe("canAccessExam", () => {
  const publicExam = (id: string) => ({ id, orgId: null });

  it("passes everything public for all-access", () => {
    expect(
      canAccessExam(
        { kind: "all", reason: "trial", ...NO_ORG },
        publicExam(EXAM_A)
      )
    ).toBe(true);
  });

  it("passes only named exams when scoped", () => {
    const access: ExamAccess = { kind: "scoped", examIds: [EXAM_A], ...NO_ORG };
    expect(canAccessExam(access, publicExam(EXAM_A))).toBe(true);
    expect(canAccessExam(access, publicExam(EXAM_B))).toBe(false);
  });

  it("blocks everything when there is no access at all", () => {
    expect(
      canAccessExam({ kind: "none", ...NO_ORG }, publicExam(EXAM_A))
    ).toBe(false);
  });

  it("unions the org's bought exams into a memberless kind", () => {
    expect(canAccessExam(MEMBER_ACCESS, publicExam(EXAM_A))).toBe(true);
    expect(canAccessExam(MEMBER_ACCESS, publicExam(EXAM_B))).toBe(false);
  });

  it("treats an org comp row as every public exam", () => {
    const comp: ExamAccess = {
      kind: "none",
      org: { orgId: ORG_1, examIds: [], allAccess: true },
    };
    expect(canAccessExam(comp, publicExam(EXAM_A))).toBe(true);
    expect(canAccessExam(comp, publicExam(EXAM_B))).toBe(true);
  });

  it("opens a private bank to its own org only, whatever was bought", () => {
    const orgExam = { id: EXAM_A, orgId: ORG_1 };
    expect(canAccessExam(MEMBER_ACCESS, orgExam)).toBe(true);
    expect(
      canAccessExam(
        { kind: "none", org: { ...RIDER, orgId: ORG_2 } },
        orgExam
      )
    ).toBe(false);
    expect(
      canAccessExam({ kind: "all", reason: "legacy", ...NO_ORG }, orgExam)
    ).toBe(false);
  });
});

describe("consumesTrialCredit", () => {
  const publicA = { id: EXAM_A, orgId: null };
  const publicB = { id: EXAM_B, orgId: null };
  const bankExam = { id: "e0000000-0000-0000-0000-000000000003", orgId: ORG_1 };
  const trialWithOrg: ExamAccess = { kind: "all", reason: "trial", org: RIDER };

  it("never meters non-trial roles", () => {
    expect(consumesTrialCredit("student", MEMBER_ACCESS, publicB)).toBe(false);
    expect(
      consumesTrialCredit("admin", { kind: "all", reason: "admin", ...NO_ORG }, publicB)
    ).toBe(false);
  });

  it("exempts org-covered exams — bought, comp, and the org's own bank", () => {
    expect(consumesTrialCredit("trial", trialWithOrg, publicA)).toBe(false);
    expect(consumesTrialCredit("trial", trialWithOrg, bankExam)).toBe(false);
    expect(
      consumesTrialCredit(
        "trial",
        { kind: "all", reason: "trial", org: { ...RIDER, examIds: [], allAccess: true } },
        publicB
      )
    ).toBe(false);
  });

  it("meters everything the org did not buy", () => {
    expect(consumesTrialCredit("trial", trialWithOrg, publicB)).toBe(true);
    expect(
      consumesTrialCredit("trial", { kind: "all", reason: "trial", ...NO_ORG }, publicA)
    ).toBe(true);
  });
});

describe("visibleExamsFor", () => {
  const live = { id: EXAM_A, isActive: true, orgId: null };
  const retired = { id: EXAM_B, isActive: false, orgId: null };
  const catalog = [live, retired];

  const ORG_EXAM_ID = "e0000000-0000-0000-0000-000000000003";
  const orgExam = { id: ORG_EXAM_ID, isActive: true, orgId: ORG_1 };

  it("hides retired exams from trial users", () => {
    // Trials are all-access for PRACTICE, but they are also prospects — a
    // retired exam must not be dangled at someone who cannot buy it.
    expect(
      visibleExamsFor(catalog, { kind: "all", reason: "trial", ...NO_ORG })
    ).toEqual([live]);
  });

  it("shows admins everything, retired and org banks included", () => {
    expect(
      visibleExamsFor([...catalog, orgExam], {
        kind: "all",
        reason: "admin",
        ...NO_ORG,
      })
    ).toEqual([...catalog, orgExam]);
  });

  it("keeps a retired exam the buyer actually owns", () => {
    expect(
      visibleExamsFor(catalog, { kind: "scoped", examIds: [EXAM_B], ...NO_ORG })
    ).toEqual(catalog);
  });

  it("keeps a retired exam the ORG bought — they paid for it", () => {
    expect(
      visibleExamsFor(catalog, {
        kind: "none",
        org: { orgId: ORG_1, examIds: [EXAM_B], allAccess: false },
      })
    ).toEqual(catalog);
    expect(
      visibleExamsFor(catalog, {
        kind: "none",
        org: { orgId: ORG_1, examIds: [], allAccess: true },
      })
    ).toEqual(catalog);
  });

  it("still hides a retired exam nobody bought", () => {
    expect(
      visibleExamsFor(catalog, { kind: "scoped", examIds: [EXAM_A], ...NO_ORG })
    ).toEqual([live]);
    expect(visibleExamsFor(catalog, MEMBER_ACCESS)).toEqual([live]);
  });

  it("keeps everything for a grandfathered all-access row", () => {
    expect(
      visibleExamsFor(catalog, { kind: "all", reason: "legacy", ...NO_ORG })
    ).toEqual(catalog);
  });

  it("hides retired exams from a lapsed student", () => {
    expect(visibleExamsFor(catalog, { kind: "none", ...NO_ORG })).toEqual([
      live,
    ]);
  });

  it("shows a member the public catalogue plus their own bank", () => {
    expect(visibleExamsFor([...catalog, orgExam], MEMBER_ACCESS)).toEqual([
      live,
      orgExam,
    ]);
  });

  it("hides another org's bank from everyone else", () => {
    const foreign = { ...orgExam, orgId: ORG_2 };
    expect(visibleExamsFor([...catalog, foreign], MEMBER_ACCESS)).toEqual([
      live,
    ]);
    expect(
      visibleExamsFor([foreign], { kind: "all", reason: "legacy", ...NO_ORG })
    ).toEqual([]);
    expect(visibleExamsFor([foreign], { kind: "none", ...NO_ORG })).toEqual([]);
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

describe("maxQuestionsFor", () => {
  it("clamps metered sessions to TRIAL_MAX_QUESTIONS", () => {
    expect(TRIAL_MAX_QUESTIONS).toBe(5);
    expect(maxQuestionsFor(true, 60)).toBe(5);
    expect(maxQuestionsFor(true, 5)).toBe(5);
    expect(maxQuestionsFor(true, 3)).toBe(3);
  });
  it("leaves unmetered sessions alone", () => {
    expect(maxQuestionsFor(false, 60)).toBe(60);
  });
});
