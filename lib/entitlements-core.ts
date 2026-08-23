/**
 * Which exams may a user practise?
 *
 * Pure, so vitest can exercise every branch without a DB — the DB-touching
 * wrapper is lib/entitlements.ts. The stale-'active'-row rule is NOT restated
 * here; it lives once in isEffectivelyActive.
 */

import { orgGrantHolds, orgSubGrants } from "@/lib/orgs-core";
import {
  daysUntil,
  EXPIRY_WARNING_DAYS,
  isEffectivelyActive,
  type SubscriptionLike,
} from "@/lib/subscriptions-core";
import type { UserRole } from "@/lib/supabase/types";

/** A subscription row as the entitlement rules see it. */
export type SubscriptionScope = SubscriptionLike & { exam_id: string | null };

/**
 * The caller's org, as the grant rules see it: membership + the org's
 * subscription rows + the suspension flag. null = not a member of any org.
 * Whether (and what) the org grants is decided here via orgAccessOf —
 * callers just fetch and pass.
 */
export type OrgGrantContext = {
  org_id: string;
  suspended_at: string | null;
  subs: readonly SubscriptionScope[];
};

/**
 * What an org membership currently entitles. Rides ALONGSIDE the personal
 * access rather than replacing it: org purchases are per exam now, so the
 * org is a second, unionable source of exam entitlement — not a blanket that
 * preempts trial breadth or personal rows.
 */
export type OrgAccess = {
  orgId: string;
  /** Public exams named by the org's granting rows (grace included). */
  examIds: string[];
  /** A granting null-exam row — an admin comp; every public exam. */
  allAccess: boolean;
};

export type ExamAccess =
  | { kind: "all"; reason: "admin" | "trial" | "legacy"; org: OrgAccess | null }
  | { kind: "scoped"; examIds: string[]; org: OrgAccess | null }
  | { kind: "none"; org: OrgAccess | null };

/**
 * The org rider, stated once. Non-null while the org grants at all
 * (suspension kills it outright; a row grants while effectively active OR
 * inside its 14-day grace — orgSubGrants). Any non-null rider also means the
 * org's own private bank is open to this member, however short its examIds.
 */
export function orgAccessOf(
  org: OrgGrantContext | null,
  now: Date
): OrgAccess | null {
  if (!org || !orgGrantHolds(org, org.subs, now)) return null;

  const granting = org.subs.filter((s) => orgSubGrants(s, now));
  return {
    orgId: org.org_id,
    examIds: [
      ...new Set(
        granting
          .map((s) => s.exam_id)
          .filter((id): id is string => id !== null)
      ),
    ],
    allAccess: granting.some((s) => s.exam_id === null),
  };
}

/**
 * Branch order is load-bearing:
 *
 *  1. admin  — staff must be able to QA every exam.
 *  2. trial  — trial users may practise ANY exam; the trial QUOTA is their
 *              limiter, not the taxonomy. Checked BEFORE the scoped branch so
 *              a trial user who has just bought one exam is never narrowed by
 *              their own purchase in the window before the role sync runs.
 *  3. a live row with exam_id null — grandfathered all-access, and the shape
 *              admin comp grants use.
 *  4. otherwise exactly the exams named by live rows.
 *
 * The ORG grant is deliberately NOT a branch: since orgs buy per exam, it is
 * an orthogonal `org` rider carried on every variant — canAccessExam unions
 * it in, and consumesTrialCredit exempts org-covered exams from the quota.
 * (The old design had an org branch before trial; that ordering constraint
 * dissolved when org access stopped being all-or-nothing.)
 *
 * A `student` with no live row and no rider lands on "none" and is blocked
 * everywhere. That is deliberate: role must never become a second, weaker
 * source of truth. NOTE consumers: "none" no longer means "no access" — a
 * paying org member with no personal rows is `{kind:"none", org:{…}}`.
 */
export function examAccessFor(
  role: UserRole,
  subs: readonly SubscriptionScope[],
  org: OrgGrantContext | null,
  now: Date
): ExamAccess {
  const rider = orgAccessOf(org, now);

  if (role === "admin") return { kind: "all", reason: "admin", org: rider };
  if (role === "trial") return { kind: "all", reason: "trial", org: rider };

  const live = subs.filter((s) => isEffectivelyActive(s, now));
  if (live.some((s) => s.exam_id === null)) {
    return { kind: "all", reason: "legacy", org: rider };
  }
  if (live.length === 0) return { kind: "none", org: rider };

  return {
    kind: "scoped",
    examIds: [...new Set(live.map((s) => s.exam_id as string))],
    org: rider,
  };
}

/**
 * May this access touch an exam owned by `examOrgId`? Stated ONCE: private
 * banks are for their own org's members (and platform admins, for QA) —
 * no breadth of PUBLIC access ever crosses an org wall. RLS enforces the
 * same rule in the database; this is the app-layer twin for pages that
 * render locks. The bank rides on ANY granting row (grace included), not on
 * which exams were bought.
 */
export function orgExamAllowed(
  access: ExamAccess,
  examOrgId: string | null
): boolean {
  if (examOrgId === null) return true;
  if (access.kind === "all" && access.reason === "admin") return true;
  return access.org?.orgId === examOrgId;
}

/**
 * Does the ORG side of this access cover the exam? Own private bank, or a
 * public exam the org bought (or a comp all-access row). The one rule both
 * canAccessExam and consumesTrialCredit defer to.
 */
function orgCoversExam(
  access: ExamAccess,
  exam: { id: string; orgId: string | null }
): boolean {
  if (!access.org) return false;
  if (exam.orgId !== null) return exam.orgId === access.org.orgId;
  return access.org.allAccess || access.org.examIds.includes(exam.id);
}

export function canAccessExam(
  access: ExamAccess,
  exam: { id: string; orgId: string | null }
): boolean {
  if (!orgExamAllowed(access, exam.orgId)) return false;
  return (
    access.kind === "all" ||
    (access.kind === "scoped" && access.examIds.includes(exam.id)) ||
    orgCoversExam(access, exam)
  );
}

/**
 * The same access, narrowed to what a PAID entitlement covers — the rule for
 * exam DOCUMENTS (syllabus and reference material).
 *
 * examAccessFor short-circuits trial users to `kind:"all"` because the trial
 * QUOTA, not the taxonomy, is their limiter for PRACTICE. Documents are not
 * practice: they are the client's licensed material, and a trial allowance
 * does not buy them. So coerce trial → student and let examAccessFor read the
 * user's ACTUAL rows.
 *
 * Deliberately a coercion rather than a restated rule (the cores cross-import,
 * they do not duplicate). Two things fall out of it for free:
 *
 *  - the trial user who has just bought one exam is not locked out of the
 *    syllabus they paid for in the window before the role sync runs — their
 *    row is in `subs`, so they land on `kind:"scoped"` naming that exam;
 *  - the org rider is computed identically either way, so orgExamAllowed and
 *    orgCoversExam keep working untouched. An org member reads the documents
 *    for the exams their org bought, and for their org's own private bank.
 *
 * Admins keep full breadth: they have to be able to QA what they publish.
 */
export function examDocumentAccessFor(
  role: UserRole,
  subs: readonly SubscriptionScope[],
  org: OrgGrantContext | null,
  now: Date
): ExamAccess {
  return examAccessFor(role === "admin" ? "admin" : "student", subs, org, now);
}

/**
 * Does starting a test on this exam burn a trial credit? The unmetered rule
 * stated once (SPEC §3): org-covered exams — bought ones, comp all-access,
 * and the org's own bank — are free for trial-ROLE members; everything else
 * a trial user practises rides the quota.
 */
export function consumesTrialCredit(
  role: UserRole,
  access: ExamAccess,
  exam: { id: string; orgId: string | null }
): boolean {
  return role === "trial" && !orgCoversExam(access, exam);
}

/**
 * Trial sessions are capped at this many questions. A trial credit buys a
 * taste of the bank, not a full-length paper: with the default two credits
 * a trial sees 10 questions in total, never 200. Stated once: /api/tests
 * clamps to it and the wizard offers only this size. Org-covered exams are
 * unmetered and so uncapped (the org paid) — see consumesTrialCredit.
 */
export const TRIAL_MAX_QUESTIONS = 5;

/** Largest session a request may ask for, given whether it rides the trial. */
export function maxQuestionsFor(consumesTrial: boolean, requested: number): number {
  return consumesTrial ? Math.min(requested, TRIAL_MAX_QUESTIONS) : requested;
}

/**
 * Which exams to LIST in the practice wizard once retired ones exist.
 *
 * Not the same question as canAccessExam: a retired exam stays visible to
 * everyone whose access names it — they paid for it — and to admins, who
 * need to QA what they are about to publish. It is hidden from trial users
 * and from students who never bought it, because the wizard lists locked
 * exams as the upsell and dangling something no longer for sale is a dead
 * end. Trials are `kind: "all"` here, hence the explicit reason check.
 */
export function visibleExamsFor<
  T extends { id: string; isActive: boolean; orgId: string | null },
>(exams: readonly T[], access: ExamAccess): T[] {
  if (access.kind === "all" && access.reason === "admin") return [...exams];

  return exams.filter((exam) => {
    // Private banks: membership decides, never the storefront — is_active
    // is a checkout concept and org exams are not sold.
    if (exam.orgId !== null) return orgExamAllowed(access, exam.orgId);

    return (
      exam.isActive ||
      (access.kind === "scoped" && access.examIds.includes(exam.id)) ||
      // A grandfathered all-access row bought the whole catalogue, retired
      // entries included; ditto an org comp row, and a retired exam the org
      // BOUGHT stays visible to its members — they paid for it.
      (access.kind === "all" && access.reason === "legacy") ||
      orgCoversExam(access, exam)
    );
  });
}

/**
 * When access ends, per exam. Key `null` is the all-access row. Latest end
 * wins per key, because repurchases of the same exam stack.
 */
export function accessEndsByExam(
  subs: readonly SubscriptionScope[],
  now: Date
): Map<string | null, string> {
  const out = new Map<string | null, string>();
  for (const sub of subs) {
    if (!isEffectivelyActive(sub, now)) continue;
    const prev = out.get(sub.exam_id);
    if (!prev || new Date(sub.current_period_end) > new Date(prev)) {
      out.set(sub.exam_id, sub.current_period_end);
    }
  }
  return out;
}

export type ExpiryWarning = {
  /** null = the all-access row. */
  examId: string | null;
  periodEnd: string;
  daysLeft: number;
};

/**
 * One warning per exam whose access ends within EXPIRY_WARNING_DAYS, soonest
 * first.
 *
 * Per-exam and not global: with separate access per exam, a single lapsing
 * exam has to raise a flag even when other access runs for months. A later
 * period for the SAME exam still suppresses the warning, because that is a
 * repurchase that has already stacked.
 */
export function expiryWarnings(
  subs: readonly SubscriptionScope[],
  now: Date
): ExpiryWarning[] {
  return [...accessEndsByExam(subs, now)]
    .map(([examId, periodEnd]) => ({
      examId,
      periodEnd,
      daysLeft: daysUntil(periodEnd, now),
    }))
    .filter((w) => w.daysLeft >= 1 && w.daysLeft <= EXPIRY_WARNING_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * Pure twin of the per-exam stacking query. Matching is STRICT on exam_id,
 * null included: an all-access row does not extend an exam-scoped purchase and
 * vice versa. They are independent products with independent end dates, and
 * cross-stacking would push a paid period out past the money that bought it.
 */
export function activePeriodEndForExamPure(
  subs: readonly SubscriptionScope[],
  examId: string | null,
  now: Date
): string | null {
  let latest: string | null = null;
  for (const sub of subs) {
    if (sub.exam_id !== examId) continue;
    if (!isEffectivelyActive(sub, now)) continue;
    if (latest === null || new Date(sub.current_period_end) > new Date(latest)) {
      latest = sub.current_period_end;
    }
  }
  return latest;
}
