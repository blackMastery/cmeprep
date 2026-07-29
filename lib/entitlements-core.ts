/**
 * Which exams may a user practise?
 *
 * Pure, so vitest can exercise every branch without a DB — the DB-touching
 * wrapper is lib/entitlements.ts. The stale-'active'-row rule is NOT restated
 * here; it lives once in isEffectivelyActive.
 */

import {
  daysUntil,
  EXPIRY_WARNING_DAYS,
  isEffectivelyActive,
  type SubscriptionLike,
} from "@/lib/subscriptions-core";
import type { UserRole } from "@/lib/supabase/types";

/** A subscription row as the entitlement rules see it. */
export type SubscriptionScope = SubscriptionLike & { exam_id: string | null };

export type ExamAccess =
  | { kind: "all"; reason: "admin" | "trial" | "legacy" }
  | { kind: "scoped"; examIds: string[] }
  | { kind: "none" };

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
 * A `student` with no live row lands on "none" and is blocked everywhere.
 * That is deliberate: role must never become a second, weaker source of truth.
 */
export function examAccessFor(
  role: UserRole,
  subs: readonly SubscriptionScope[],
  now: Date
): ExamAccess {
  if (role === "admin") return { kind: "all", reason: "admin" };
  if (role === "trial") return { kind: "all", reason: "trial" };

  const live = subs.filter((s) => isEffectivelyActive(s, now));
  if (live.length === 0) return { kind: "none" };
  if (live.some((s) => s.exam_id === null)) {
    return { kind: "all", reason: "legacy" };
  }

  return {
    kind: "scoped",
    examIds: [...new Set(live.map((s) => s.exam_id as string))],
  };
}

export function canAccessExam(access: ExamAccess, examId: string): boolean {
  return (
    access.kind === "all" ||
    (access.kind === "scoped" && access.examIds.includes(examId))
  );
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
export function visibleExamsFor<T extends { id: string; isActive: boolean }>(
  exams: readonly T[],
  access: ExamAccess
): T[] {
  if (access.kind === "all" && access.reason === "admin") return [...exams];

  return exams.filter(
    (exam) =>
      exam.isActive ||
      (access.kind === "scoped" && access.examIds.includes(exam.id)) ||
      // A grandfathered all-access row bought the whole catalogue, retired
      // entries included.
      (access.kind === "all" && access.reason === "legacy")
  );
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
