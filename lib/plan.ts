import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SessionUser } from "@/lib/auth";
import { audit } from "@/lib/admin/audit";
import { getExamAccess } from "@/lib/entitlements";
import { canAccessExam, type ExamAccess } from "@/lib/entitlements-core";
import { listExamCatalog } from "@/lib/catalog";
import type { CatalogExam } from "@/lib/catalog-core";
import {
  addDays,
  guyanaDay,
  mondayOf,
  readinessWindowStart,
  sittingFraming,
  type SittingFraming,
} from "@/lib/orgs-core";
import {
  ADHERENCE_WEEKS,
  adherencePct,
  buildWeekActivities,
  emptyWeekActivity,
  evaluateWeekProgress,
  generateWeekGoals,
  goalTitle,
  pickPrimaryExam,
  weeksToExam,
  type ActivityRows,
  type PlanSubjectStat,
  type WeekActivity,
  type WeekProgress,
} from "@/lib/plan-core";
import { planGoalsDocSchema, type PlanGoalsDoc } from "@/lib/validation";
import type {
  PlanIntensity,
  StudyPlanSettings,
  StudyPlanWeek,
  TestMode,
} from "@/lib/supabase/types";

/**
 * DB layer for study plans (SPEC §17). Owner READS run on the RLS client;
 * study_plan_weeks WRITES run on the admin client because clients hold no
 * insert/update/delete grant at all — a client-writable week row would let a
 * member forge the org-visible adherence metric. Every admin-client query
 * scopes with `.eq()`/`.in()` — those filters are the wall.
 */

/** How many past weeks the /plan history section shows. */
const HISTORY_WEEKS = 12;

/** How far back org adherence looks for "has this member EVER planned" —
 * beyond it a lapsed plan honestly reads "—" rather than 0%. */
const ADHERENCE_PROBE_WEEKS = 26;

/** The exact week bucket for a mock's submitted_at (the SQL views' rule). */
const mockWeekOf = (submittedAt: string): string =>
  mondayOf(guyanaDay(new Date(submittedAt)));

/** Exams the caller can hold a plan for, in catalog (entitlement) order. */
export async function listPlanExams(
  user: SessionUser
): Promise<{ access: ExamAccess; exams: CatalogExam[] }> {
  const [access, catalog] = await Promise.all([
    getExamAccess(user),
    listExamCatalog(),
  ]);
  return {
    access,
    exams: catalog.filter((exam) =>
      canAccessExam(access, { id: exam.id, orgId: exam.orgId })
    ),
  };
}

export type ResolvedSitting = {
  /** Personal date, else the org's org_exam_dates row, else null. */
  sittingOn: string | null;
  source: "personal" | "org" | null;
};

export type PlanSettingsView = {
  intensity: PlanIntensity;
  /** The PERSONAL date only — the settings form edits this, not the org's. */
  sittingOn: string | null;
  diagnosticDismissed: boolean;
};

const defaultSettings: PlanSettingsView = {
  intensity: "standard",
  sittingOn: null,
  diagnosticDismissed: false,
};

async function getSettings(
  userId: string,
  examId: string
): Promise<PlanSettingsView> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("study_plan_settings")
    .select("*")
    .eq("user_id", userId)
    .eq("exam_id", examId)
    .maybeSingle();
  const row = data as StudyPlanSettings | null;
  if (!row) return defaultSettings;
  return {
    intensity: row.intensity,
    sittingOn: row.sitting_on,
    diagnosticDismissed: row.diagnostic_dismissed_at !== null,
  };
}

/** Org sitting dates for the caller's org, keyed by exam — the ONE org-date
 * fetch. RLS scopes both reads; a non-member simply gets an empty map. */
async function listOrgDatesFor(
  userId: string,
  examIds: string[]
): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return new Map();
  const { data } = await supabase
    .from("org_exam_dates")
    .select("exam_id, sitting_on")
    .eq("org_id", membership.org_id)
    .in("exam_id", examIds);
  return new Map((data ?? []).map((d) => [d.exam_id, d.sitting_on as string]));
}

function resolveSitting(
  settings: PlanSettingsView,
  orgDate: string | null
): ResolvedSitting {
  if (settings.sittingOn !== null) {
    return { sittingOn: settings.sittingOn, source: "personal" };
  }
  if (orgDate !== null) return { sittingOn: orgDate, source: "org" };
  return { sittingOn: null, source: null };
}

export type PlanWeekView = {
  id: string;
  weekStart: string;
  /** Null = the stored doc failed the versioned parse (see planGoalsDocSchema). */
  doc: PlanGoalsDoc | null;
  progress: WeekProgress | null;
};

const parseDoc = (goals: unknown): PlanGoalsDoc | null => {
  const parsed = planGoalsDocSchema.safeParse(goals);
  return parsed.success ? parsed.data : null;
};

/** Settings + org date preloaded by a caller that already fetched them —
 * getPlanOverview passes these so a generation render doesn't re-read. */
type PlanContext = { settings: PlanSettingsView; orgDate: string | null };

/**
 * The lazy generator: return this week's frozen row, creating it on first
 * visit. Race-safe — the unique (user, exam, week_start) key plus an
 * ignoreDuplicates upsert means two concurrent first visits land on the
 * same row. Writes go through the admin client (clients hold no insert
 * grant); callers verify exam entitlement BEFORE calling.
 */
export async function getOrCreateCurrentWeek(
  user: SessionUser,
  examId: string,
  now: Date = new Date(),
  pre?: PlanContext
): Promise<StudyPlanWeek> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const weekStart = mondayOf(guyanaDay(now));

  const { data: existing } = await supabase
    .from("study_plan_weeks")
    .select("*")
    .eq("user_id", user.id)
    .eq("exam_id", examId)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (existing) {
    if (parseDoc((existing as StudyPlanWeek).goals)) {
      return existing as StudyPlanWeek;
    }
    // Self-heal: a doc THIS schema version can't read (deploy skew, junk).
    // Deleting and regenerating beats the alternative — /plan crashing for
    // the rest of the week against a frozen row nobody can repair.
    await admin.from("study_plan_weeks").delete().eq("id", existing.id);
    await audit(user.id, "study_plan.week_reset", user.id, {
      examId,
      weekStart,
      reason: "unparseable",
    });
  }

  const [
    settings,
    orgDate,
    { data: subjectRows },
    { data: roster },
    { data: totals },
    { data: priorWeeks },
    { count: priorCount },
  ] = await Promise.all([
    pre?.settings ?? getSettings(user.id, examId),
    pre !== undefined
      ? pre.orgDate
      : listOrgDatesFor(user.id, [examId]).then((m) => m.get(examId) ?? null),
    supabase
      .from("subject_accuracy")
      .select("subject_id, attempts, accuracy_pct")
      .eq("user_id", user.id)
      .eq("exam_id", examId),
    supabase.from("exam_subject_counts").select("*").eq("exam_id", examId),
    supabase
      .from("user_exam_stats")
      .select("attempts")
      .eq("user_id", user.id)
      .eq("exam_id", examId)
      .maybeSingle(),
    // Recent prior docs, newest first — enough to find the last prescribed
    // mock (cadence maxes out at biweekly, 8 weeks is generous headroom).
    supabase
      .from("study_plan_weeks")
      .select("week_start, goals")
      .eq("user_id", user.id)
      .eq("exam_id", examId)
      .lt("week_start", weekStart)
      .order("week_start", { ascending: false })
      .limit(8),
    supabase
      .from("study_plan_weeks")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("exam_id", examId)
      .lt("week_start", weekStart),
  ]);

  const accuracyBySubject = new Map(
    (subjectRows ?? []).map((r) => [
      r.subject_id,
      {
        attempts: r.attempts as number,
        accuracyPct: r.accuracy_pct === null ? null : Number(r.accuracy_pct),
      },
    ])
  );
  const subjects: PlanSubjectStat[] = (roster ?? []).map((s) => ({
    subjectId: s.subject_id,
    subjectName: s.subject_name,
    // MCQ-only: plan sessions launch as exam/tutor, which deal no OSCE
    // stations — sizing goals against the inclusive count would freeze in
    // focus sessions that can never reach their completion threshold.
    questionCount: s.mcq_question_count,
    attempts: accuracyBySubject.get(s.subject_id)?.attempts ?? 0,
    accuracyPct: accuracyBySubject.get(s.subject_id)?.accuracyPct ?? null,
  }));

  const lastMockGoalWeekStart =
    (priorWeeks ?? [])
      .map((w) => ({ weekStart: w.week_start as string, doc: parseDoc(w.goals) }))
      .find((w) => w.doc?.goals.some((g) => g.type === "mock"))?.weekStart ??
    null;

  const sitting = resolveSitting(settings, orgDate);
  const doc = generateWeekGoals({
    weekStart,
    intensity: settings.intensity,
    // From TODAY, not the week's Monday — a sitting that passed on Tuesday
    // must not ramp a week generated on Friday.
    weeksToExam: weeksToExam(sitting.sittingOn, guyanaDay(now)),
    subjects,
    allTimeAttempts: totals?.attempts ?? 0,
    lastMockGoalWeekStart,
    priorWeekCount: priorCount ?? 0,
    diagnosticDismissed: settings.diagnosticDismissed,
  });

  await admin.from("study_plan_weeks").upsert(
    {
      user_id: user.id,
      exam_id: examId,
      week_start: weekStart,
      goals: doc,
      intensity: settings.intensity,
    },
    { onConflict: "user_id,exam_id,week_start", ignoreDuplicates: true }
  );

  // Re-select rather than trusting the upsert result: with ignoreDuplicates
  // a lost race returns no row, and the winner's frozen doc is the truth.
  const { data: row, error } = await supabase
    .from("study_plan_weeks")
    .select("*")
    .eq("user_id", user.id)
    .eq("exam_id", examId)
    .eq("week_start", weekStart)
    .single();
  // No row here means the upsert itself failed (not a lost race) — surface
  // it; returning null would just crash the caller later.
  if (error || !row) throw new Error("Could not create this week's plan");
  return row as StudyPlanWeek;
}

/**
 * Activity per week from `fromWeekStart` on, keyed by week_start, for ONE
 * user. Queries here, fold in plan-core (buildWeekActivities) — the same
 * fold org adherence uses, so the two surfaces can never disagree. The
 * session and mock reads are paged: a heavy user's 13-week history can
 * outgrow PostgREST's 1000-row cap.
 */
async function getWeekActivities(
  userId: string,
  examId: string,
  fromWeekStart: string
): Promise<Map<string, WeekActivity>> {
  const supabase = await createClient();

  const sessions: ActivityRows["sessions"] = [];
  const mocks: ActivityRows["mocks"] = [];
  const [{ data: weekly }] = await Promise.all([
    supabase
      .from("user_exam_weekly_mode_accuracy")
      .select("week_start, attempts")
      .eq("user_id", userId)
      .eq("exam_id", examId)
      .gte("week_start", fromWeekStart),
    (async () => {
      for (let from = 0; ; from += 1000) {
        const { data: page } = await supabase
          .from("user_exam_week_test_subject_attempts")
          .select("week_start, subject_id, test_id, mode, attempts")
          .eq("user_id", userId)
          .eq("exam_id", examId)
          .gte("week_start", fromWeekStart)
          // Unique per user: (test_id, subject_id, week_start) — resumable
          // tutor tests can span weeks, so week_start is part of the grain.
          .order("test_id")
          .order("subject_id")
          .order("week_start")
          .range(from, from + 999);
        for (const r of page ?? []) {
          sessions.push({
            weekStart: r.week_start,
            subjectId: r.subject_id,
            testId: r.test_id,
            mode: r.mode as TestMode,
            attempts: r.attempts,
          });
        }
        if (!page || page.length < 1000) break;
      }
    })(),
    (async () => {
      // Mock goals key off submitted exam-mode TESTS (readiness precedent):
      // config->>exam_id is unindexed JSON-path, fine because user_id
      // narrows first. The T00:00:00Z bound is the documented "close enough"
      // timezone seam; the fold's bucket is the exact one.
      for (let from = 0; ; from += 1000) {
        const { data: page } = await supabase
          .from("tests")
          .select("id, total_questions, submitted_at")
          .eq("user_id", userId)
          .eq("mode", "exam")
          .eq("status", "submitted")
          .eq("config->>exam_id", examId)
          .gte("submitted_at", `${fromWeekStart}T00:00:00Z`)
          .order("id")
          .range(from, from + 999);
        for (const r of page ?? []) {
          mocks.push({
            submittedAt: r.submitted_at,
            totalQuestions: r.total_questions,
          });
        }
        if (!page || page.length < 1000) break;
      }
    })(),
  ]);

  return buildWeekActivities(
    {
      weekly: (weekly ?? []).map((r) => ({
        weekStart: r.week_start,
        attempts: r.attempts,
      })),
      sessions,
      mocks,
    },
    fromWeekStart,
    mockWeekOf
  );
}

export type PlanOverview = {
  examId: string;
  weekStart: string;
  current: PlanWeekView & { doc: PlanGoalsDoc; progress: WeekProgress };
  /** Existing past weeks, newest first — gaps simply have no entry. */
  history: PlanWeekView[];
  settings: PlanSettingsView;
  sitting: ResolvedSitting & { framing: SittingFraming | null };
};

/** Everything the /plan page needs for one exam. Generates this week's row
 * if it doesn't exist yet — the ONLY place lazy generation happens. */
export async function getPlanOverview(
  user: SessionUser,
  examId: string,
  now: Date = new Date()
): Promise<PlanOverview> {
  // Settings + org date load once and feed both generation and the view.
  const [settings, orgDate] = await Promise.all([
    getSettings(user.id, examId),
    listOrgDatesFor(user.id, [examId]).then((m) => m.get(examId) ?? null),
  ]);
  const currentWeek = await getOrCreateCurrentWeek(user, examId, now, {
    settings,
    orgDate,
  });
  const weekStart = currentWeek.week_start;

  const supabase = await createClient();
  const historyFrom = addDays(weekStart, -HISTORY_WEEKS * 7);
  const [{ data: pastRows }, activities] = await Promise.all([
    supabase
      .from("study_plan_weeks")
      .select("*")
      .eq("user_id", user.id)
      .eq("exam_id", examId)
      .gte("week_start", historyFrom)
      .lt("week_start", weekStart)
      .order("week_start", { ascending: false }),
    getWeekActivities(user.id, examId, historyFrom),
  ]);

  const view = (row: StudyPlanWeek): PlanWeekView => {
    const doc = parseDoc(row.goals);
    const activity = activities.get(row.week_start) ?? emptyWeekActivity();
    return {
      id: row.id,
      weekStart: row.week_start,
      doc,
      progress: doc ? evaluateWeekProgress(doc, activity) : null,
    };
  };

  const current = view(currentWeek);
  if (!current.doc || !current.progress) {
    // getOrCreateCurrentWeek self-heals unparseable rows, so this can only
    // be a generator bug — surface it, never render an empty plan silently.
    throw new Error("Current plan week failed to parse");
  }

  const sitting = resolveSitting(settings, orgDate);
  return {
    examId,
    weekStart,
    current: { ...current, doc: current.doc, progress: current.progress },
    history: ((pastRows ?? []) as StudyPlanWeek[]).map(view),
    settings,
    sitting: { ...sitting, framing: sittingFraming(sitting.sittingOn, now) },
  };
}

/**
 * Retry pool for one subject: question ids whose LATEST attempt is wrong.
 * Admin client (the launch route already holds it); `.eq` filters are the
 * wall, and the ids never leave the server.
 */
export async function retryPoolQuestionIds(
  userId: string,
  subjectId: string,
  limit = 200
): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("user_question_latest_outcome")
    .select("question_id")
    .eq("user_id", userId)
    .eq("subject_id", subjectId)
    .eq("is_correct", false)
    .limit(limit);
  return (data ?? []).map((r) => r.question_id);
}

export type PlanCardData = {
  examId: string;
  examName: string;
  /** Null = no row this week yet — the card shows a CTA, it NEVER generates. */
  progress: { metCount: number; total: number } | null;
  /** First unmet goal's human label, for the card's "next up" line. */
  nextGoalLabel: string | null;
  daysToExam: number | null;
};

/**
 * The primary exam for a set of entitled exams (the getOwnReadiness
 * tiebreaker over resolved sitting dates + window practice), plus the
 * resolved sitting per exam — shared by the /plan default tab and the
 * dashboard card so the two plan surfaces always agree.
 */
export async function resolvePrimaryPlanExam(
  user: SessionUser,
  exams: readonly CatalogExam[],
  now: Date = new Date()
): Promise<{ primaryId: string | null; sittings: Map<string, string> }> {
  if (exams.length === 0) return { primaryId: null, sittings: new Map() };

  const supabase = await createClient();
  const examIds = exams.map((e) => e.id);
  const windowStart = readinessWindowStart(now);
  const [{ data: settingsRows }, orgDates, { data: weeklyRows }] =
    await Promise.all([
      supabase
        .from("study_plan_settings")
        .select("exam_id, sitting_on")
        .eq("user_id", user.id),
      listOrgDatesFor(user.id, examIds),
      supabase
        .from("user_exam_weekly_mode_accuracy")
        .select("exam_id, attempts")
        .eq("user_id", user.id)
        .in("exam_id", examIds)
        .gte("week_start", windowStart),
    ]);

  const sittings = new Map(orgDates);
  for (const r of settingsRows ?? []) {
    // Personal dates override org ones.
    if (r.sitting_on !== null) sittings.set(r.exam_id, r.sitting_on as string);
  }
  const attemptsByExam = new Map<string, number>();
  for (const r of weeklyRows ?? []) {
    attemptsByExam.set(r.exam_id, (attemptsByExam.get(r.exam_id) ?? 0) + r.attempts);
  }

  const primaryId = pickPrimaryExam(
    exams.map((e) => ({
      examId: e.id,
      sittingOn: sittings.get(e.id) ?? null,
      windowAttempts: attemptsByExam.get(e.id) ?? 0,
    })),
    guyanaDay(now)
  );
  return { primaryId, sittings };
}

/**
 * The dashboard card: primary exam (readiness tiebreaker) + this week's
 * progress. Read-only by design — dashboard renders must not write, so a
 * missing week renders as "see this week's plan" instead of generating.
 */
export async function getPlanCard(
  user: SessionUser,
  now: Date = new Date()
): Promise<PlanCardData | null> {
  const { exams } = await listPlanExams(user);
  if (exams.length === 0) return null;

  const { primaryId, sittings } = await resolvePrimaryPlanExam(user, exams, now);
  if (primaryId === null) return null;
  const exam = exams.find((e) => e.id === primaryId)!;

  const supabase = await createClient();
  const weekStart = mondayOf(guyanaDay(now));
  const { data: weekRow } = await supabase
    .from("study_plan_weeks")
    .select("*")
    .eq("user_id", user.id)
    .eq("exam_id", primaryId)
    .eq("week_start", weekStart)
    .maybeSingle();

  const framing = sittingFraming(sittings.get(primaryId) ?? null, now);
  const daysToExam = framing?.kind === "upcoming" ? framing.daysRemaining : null;

  const doc = weekRow ? parseDoc((weekRow as StudyPlanWeek).goals) : null;
  if (!doc) {
    return {
      examId: primaryId,
      examName: exam.name,
      progress: null,
      nextGoalLabel: null,
      daysToExam,
    };
  }
  const activities = await getWeekActivities(user.id, primaryId, weekStart);
  const progress = evaluateWeekProgress(
    doc,
    activities.get(weekStart) ?? emptyWeekActivity()
  );
  const firstUnmet = progress.goals.find((g) => !g.met);
  const unmetGoal = firstUnmet
    ? doc.goals.find((g) => g.id === firstUnmet.goalId)
    : undefined;

  return {
    examId: primaryId,
    examName: exam.name,
    progress: { metCount: progress.metCount, total: progress.total },
    nextGoalLabel: unmetGoal ? goalTitle(unmetGoal) : null,
    daysToExam,
  };
}

export type MemberPlanAdherence = {
  /** Rolling ADHERENCE_WEEKS goal-completion %; null = never planned
   * (within the probe horizon). */
  adherencePct: number | null;
  /** A plan row exists for the CURRENT week. */
  hasActivePlan: boolean;
};

/**
 * Plan adherence for a set of org members, one exam (SPEC §17 org
 * visibility: this derived pair is ALL an org ever sees — goals, intensity
 * and personal sitting dates stay private). Admin client; the `.in`/`.eq`
 * filters are the wall. Caller chunks like the readiness dashboard —
 * userIds here should already be one MEMBER_CHUNK.
 */
export async function planAdherenceForMembers(
  examId: string,
  userIds: string[],
  now: Date = new Date()
): Promise<Map<string, MemberPlanAdherence>> {
  const result = new Map<string, MemberPlanAdherence>();
  if (userIds.length === 0) return result;

  const admin = createAdminClient();
  const currentWeek = mondayOf(guyanaDay(now));
  const windowStart = addDays(currentWeek, -ADHERENCE_WEEKS * 7);
  const probeStart = addDays(currentWeek, -ADHERENCE_PROBE_WEEKS * 7);

  // Every multi-member read below is paged — a heavy cohort can outgrow
  // PostgREST's 1000-row cap on any of them, and truncation here silently
  // corrupts an org-visible metric. Sorts are unique per query (comments).
  const weekRows: { user_id: string; week_start: string; goals: unknown }[] = [];
  const weeklyByUser = new Map<string, ActivityRows["weekly"]>();
  const sessionsByUser = new Map<string, ActivityRows["sessions"]>();
  const mocksByUser = new Map<string, ActivityRows["mocks"]>();
  const earliestOlder = new Map<string, string>();

  const listFor = <T>(map: Map<string, T[]>, id: string): T[] => {
    const existing = map.get(id);
    if (existing) return existing;
    const fresh: T[] = [];
    map.set(id, fresh);
    return fresh;
  };

  await Promise.all([
    (async () => {
      // (user_id, week_start) is unique — one plan row per member-week.
      for (let from = 0; ; from += 1000) {
        const { data: page } = await admin
          .from("study_plan_weeks")
          .select("user_id, week_start, goals")
          .in("user_id", userIds)
          .eq("exam_id", examId)
          .gte("week_start", windowStart)
          .order("user_id")
          .order("week_start")
          .range(from, from + 999);
        weekRows.push(...(page ?? []));
        if (!page || page.length < 1000) break;
      }
    })(),
    (async () => {
      // (user_id, week_start, mode) is the view's grain for one exam.
      for (let from = 0; ; from += 1000) {
        const { data: page } = await admin
          .from("user_exam_weekly_mode_accuracy")
          .select("user_id, week_start, mode, attempts")
          .in("user_id", userIds)
          .eq("exam_id", examId)
          .gte("week_start", windowStart)
          .order("user_id")
          .order("week_start")
          .order("mode")
          .range(from, from + 999);
        for (const r of page ?? []) {
          listFor(weeklyByUser, r.user_id).push({
            weekStart: r.week_start,
            attempts: r.attempts,
          });
        }
        if (!page || page.length < 1000) break;
      }
    })(),
    (async () => {
      // (test_id, subject_id, week_start) is unique — resumable tutor tests
      // can span weeks, so week_start is part of the grain.
      for (let from = 0; ; from += 1000) {
        const { data: page } = await admin
          .from("user_exam_week_test_subject_attempts")
          .select("user_id, week_start, subject_id, test_id, mode, attempts")
          .in("user_id", userIds)
          .eq("exam_id", examId)
          .gte("week_start", windowStart)
          .order("test_id")
          .order("subject_id")
          .order("week_start")
          .range(from, from + 999);
        for (const r of page ?? []) {
          listFor(sessionsByUser, r.user_id).push({
            weekStart: r.week_start,
            subjectId: r.subject_id,
            testId: r.test_id,
            mode: r.mode as TestMode,
            attempts: r.attempts,
          });
        }
        if (!page || page.length < 1000) break;
      }
    })(),
    (async () => {
      for (let from = 0; ; from += 1000) {
        const { data: page } = await admin
          .from("tests")
          .select("id, user_id, total_questions, submitted_at")
          .in("user_id", userIds)
          .eq("mode", "exam")
          .eq("status", "submitted")
          .eq("config->>exam_id", examId)
          .gte("submitted_at", `${windowStart}T00:00:00Z`)
          .order("id")
          .range(from, from + 999);
        for (const r of page ?? []) {
          listFor(mocksByUser, r.user_id).push({
            submittedAt: r.submitted_at,
            totalQuestions: r.total_questions,
          });
        }
        if (!page || page.length < 1000) break;
      }
    })(),
    (async () => {
      // Existence probe: the earliest OLDER row per member, so a lapsed
      // plan reads 0% rather than "—". Cheap columns only.
      for (let from = 0; ; from += 1000) {
        const { data: page } = await admin
          .from("study_plan_weeks")
          .select("user_id, week_start")
          .in("user_id", userIds)
          .eq("exam_id", examId)
          .gte("week_start", probeStart)
          .lt("week_start", windowStart)
          .order("week_start")
          .order("user_id")
          .range(from, from + 999);
        for (const r of page ?? []) {
          if (!earliestOlder.has(r.user_id)) {
            earliestOlder.set(r.user_id, r.week_start);
          }
        }
        if (!page || page.length < 1000) break;
      }
    })(),
  ]);

  // One shared fold (plan-core) — the same rule the student's own /plan
  // runs, so the two surfaces can never disagree about a week's contents.
  const activityByUser = new Map<string, Map<string, WeekActivity>>();
  for (const id of userIds) {
    activityByUser.set(
      id,
      buildWeekActivities(
        {
          weekly: weeklyByUser.get(id) ?? [],
          sessions: sessionsByUser.get(id) ?? [],
          mocks: mocksByUser.get(id) ?? [],
        },
        windowStart,
        mockWeekOf
      )
    );
  }

  const weeksByUser = new Map<
    string,
    { weekStart: string; metCount: number; total: number }[]
  >();
  const active = new Set<string>();
  for (const r of weekRows) {
    if (r.week_start === currentWeek) {
      active.add(r.user_id);
      continue; // the in-progress week never enters adherence
    }
    const doc = parseDoc(r.goals);
    const list = listFor(weeksByUser, r.user_id);
    if (doc) {
      const activity =
        activityByUser.get(r.user_id)?.get(r.week_start) ?? emptyWeekActivity();
      const progress = evaluateWeekProgress(doc, activity);
      list.push({
        weekStart: r.week_start,
        metCount: progress.metCount,
        total: progress.total,
      });
    } else {
      // total 0 = the "unparseable" sentinel adherencePct drops entirely.
      list.push({ weekStart: r.week_start, metCount: 0, total: 0 });
    }
  }

  for (const id of userIds) {
    result.set(id, {
      adherencePct: adherencePct(
        weeksByUser.get(id) ?? [],
        currentWeek,
        earliestOlder.get(id)
      ),
      hasActivePlan: active.has(id),
    });
  }
  return result;
}
