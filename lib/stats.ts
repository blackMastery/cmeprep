import "server-only";

import { createClient } from "@/lib/supabase/server";
import { calculateStreak } from "@/lib/scoring";
import { orgAccessOf } from "@/lib/entitlements-core";
import {
  memberReadiness,
  readinessWindowStart,
  sittingFraming,
  READINESS_MIN_ATTEMPTS,
  type MemberReadiness,
  type SittingFraming,
  type WeeklyModeBucket,
} from "@/lib/orgs-core";
import type {
  TestMode,
  UserModeStats,
  UserStats,
} from "@/lib/supabase/types";

export type LifetimeStats = {
  stats: UserStats | null;
  /** Exam vs tutor split of the same attempts; null when a mode has none. */
  examStats: UserModeStats | null;
  tutorStats: UserModeStats | null;
  streak: number;
};

/**
 * Lifetime aggregates for one user, shared by the dashboard and the profile
 * page. Reads the security-invoker views through the RLS'd client — they are
 * granted to `authenticated` and scoped per-user by design.
 *
 * The streak seed date is UTC "today" while `user_daily_activity` buckets by
 * America/Guyana — a pre-existing seam kept verbatim so both pages agree.
 */
export async function getLifetimeStats(userId: string): Promise<LifetimeStats> {
  const supabase = await createClient();

  const [{ data: stats }, { data: modeStats }, { data: days }] =
    await Promise.all([
      supabase
        .from("user_stats")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase.from("user_mode_stats").select("*").eq("user_id", userId),
      supabase
        .from("user_daily_activity")
        .select("day")
        .eq("user_id", userId)
        .order("day", { ascending: false })
        .limit(400),
    ]);

  const byMode = (modeStats ?? []) as UserModeStats[];

  return {
    stats: (stats as UserStats | null) ?? null,
    examStats: byMode.find((m) => m.mode === "exam") ?? null,
    tutorStats: byMode.find((m) => m.mode === "tutor") ?? null,
    streak: calculateStreak(
      (days ?? []).map((d) => d.day as string),
      new Date().toISOString().slice(0, 10)
    ),
  };
}

export type OwnReadiness = {
  examId: string;
  examName: string;
  orgName: string;
  sitting: SittingFraming | null;
  readiness: MemberReadiness;
  /** Per-exam all-time attempts — powers the "answer N more" copy. */
  attempted: number;
  attemptsNeeded: number;
  /** Weakest practised-or-untouched subject, for the coverage guidance line. */
  focusSubject: string | null;
};

/**
 * The member's OWN readiness for their org's exam (SPEC §8 v2) — the same
 * memberReadiness formula the org dashboard runs, over the same views, but
 * through the RLS client so it can only ever see this member's rows. The
 * dashboard card SOFT-frames the result (components/dashboard/readiness-card):
 * guidance, never "at risk".
 *
 * Org members only in v1: the score's inputs (pass mark, inactivity window,
 * sitting date) are org knobs — without an org there is nothing to measure
 * against, and the card simply doesn't render.
 */
export async function getOwnReadiness(
  userId: string,
  now: Date = new Date()
): Promise<OwnReadiness | null> {
  const supabase = await createClient();

  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id, joined_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return null;

  const [{ data: org }, { data: subs }, { data: exams }, { data: dates }] =
    await Promise.all([
      supabase
        .from("orgs")
        .select("id, name, pass_mark_pct, risk_inactivity_days, suspended_at")
        .eq("id", membership.org_id)
        .maybeSingle(),
      supabase
        .from("org_subscriptions")
        .select("status, current_period_end, exam_id")
        .eq("org_id", membership.org_id),
      // RLS narrows this to what the member can see anyway (public catalog +
      // their org's bank).
      supabase.from("exams").select("id, name, org_id"),
      supabase
        .from("org_exam_dates")
        .select("exam_id, sitting_on")
        .eq("org_id", membership.org_id),
    ]);
  if (!org) return null;

  const access = orgAccessOf(
    {
      org_id: org.id,
      suspended_at: org.suspended_at,
      subs: (subs ?? []) as { status: "active" | "expired" | "cancelled"; current_period_end: string; exam_id: string | null }[],
    },
    now
  );
  const entitled = (exams ?? []).filter(
    (e) =>
      e.org_id === org.id ||
      (access !== null && (access.allAccess || access.examIds.includes(e.id)))
  );
  if (entitled.length === 0) return null;

  const windowStart = readinessWindowStart(now);
  const sittingByExam = new Map(
    (dates ?? []).map((d) => [d.exam_id, d.sitting_on as string])
  );

  // Exam pick: soonest upcoming sitting wins; otherwise the entitled exam
  // with the most window practice — measure what they're actually studying.
  let examId: string | undefined = entitled
    .filter((e) => {
      const framing = sittingFraming(sittingByExam.get(e.id) ?? null, now);
      return framing?.kind === "upcoming";
    })
    .sort((a, b) =>
      sittingByExam.get(a.id)!.localeCompare(sittingByExam.get(b.id)!)
    )[0]?.id;

  const { data: weeklyAll } = await supabase
    .from("user_exam_weekly_mode_accuracy")
    .select("exam_id, week_start, mode, attempts, correct")
    .eq("user_id", userId)
    .gte("week_start", windowStart);
  if (examId === undefined) {
    const byExam = new Map<string, number>();
    const entitledIds = new Set(entitled.map((e) => e.id));
    for (const r of weeklyAll ?? []) {
      if (!entitledIds.has(r.exam_id)) continue;
      byExam.set(r.exam_id, (byExam.get(r.exam_id) ?? 0) + r.attempts);
    }
    examId = [...byExam.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }
  if (examId === undefined) examId = entitled[0].id;
  const exam = entitled.find((e) => e.id === examId)!;

  const [
    { data: activity },
    { data: totals },
    { data: subjectRows },
    { data: roster },
    { data: mocks },
  ] = await Promise.all([
    supabase
      .from("user_exam_weekly_activity")
      .select("week_start, active_days")
      .eq("user_id", userId)
      .eq("exam_id", examId)
      .gte("week_start", windowStart),
    supabase
      .from("user_exam_stats")
      .select("attempts, correct, last_active_day")
      .eq("user_id", userId)
      .eq("exam_id", examId)
      .maybeSingle(),
    supabase
      .from("subject_accuracy")
      .select("subject_id, attempts, accuracy_pct")
      .eq("user_id", userId)
      .eq("exam_id", examId),
    supabase.from("exam_subject_counts").select("*").eq("exam_id", examId),
    supabase
      .from("tests")
      .select("id")
      .eq("user_id", userId)
      .eq("mode", "exam")
      .eq("status", "submitted")
      .eq("config->>exam_id", examId)
      .gte("submitted_at", `${windowStart}T00:00:00Z`)
      .limit(1),
  ]);

  const subjectStat = new Map(
    (subjectRows ?? []).map((r) => [
      r.subject_id,
      {
        attempts: r.attempts as number,
        accuracyPct: r.accuracy_pct === null ? null : Number(r.accuracy_pct),
      },
    ])
  );
  const subjects = (roster ?? []).map((s) => ({
    subjectId: s.subject_id as string,
    subjectName: s.subject_name as string,
    questionCount: s.question_count as number,
    attempts: subjectStat.get(s.subject_id)?.attempts ?? 0,
    accuracyPct: subjectStat.get(s.subject_id)?.accuracyPct ?? null,
  }));

  const readiness = memberReadiness(
    {
      passMarkPct: org.pass_mark_pct,
      inactivityDays: org.risk_inactivity_days,
      weekly: (weeklyAll ?? [])
        .filter((r) => r.exam_id === examId)
        .map(
          (r): WeeklyModeBucket => ({
            weekStart: r.week_start,
            mode: r.mode as TestMode,
            attempts: r.attempts,
            correct: r.correct,
          })
        ),
      weeklyActiveDays: (activity ?? []).map((r) => ({
        weekStart: r.week_start,
        days: r.active_days,
      })),
      allTime: {
        attempts: totals?.attempts ?? 0,
        correct: totals?.correct ?? 0,
      },
      subjects,
      hasExamModeTestInWindow: (mocks ?? []).length > 0,
      // The real value — same formula as the org side, one source of truth.
      // The card soft-frames an `inactive` reason as "pick it back up".
      lastActiveDay: totals?.last_active_day ?? null,
      joinedAt: membership.joined_at,
    },
    now
  );

  const focusSubject =
    subjects
      .filter((s) => s.questionCount > 0)
      .sort((a, b) => (a.accuracyPct ?? -1) - (b.accuracyPct ?? -1))[0]
      ?.subjectName ?? null;

  return {
    examId,
    examName: exam.name as string,
    orgName: org.name as string,
    sitting: sittingFraming(sittingByExam.get(examId) ?? null, now),
    readiness,
    attempted: totals?.attempts ?? 0,
    attemptsNeeded: Math.max(0, READINESS_MIN_ATTEMPTS - (totals?.attempts ?? 0)),
    focusSubject,
  };
}
