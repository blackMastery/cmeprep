import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { calculateStreak } from "@/lib/scoring";
import {
  adminDigestWorthSending,
  dedupeKey,
  DIGEST_SUBJECT_MIN_ATTEMPTS,
  DIGEST_WEAK_SUBJECTS,
  DUE_SOON_HOURS,
  EMAIL_BUDGET_MS,
  expiryReminderStage,
  FAILURE_ALERT_THRESHOLD,
  FAILURE_ALERT_WINDOW_HOURS,
  failureAlertDue,
  formatDateLong,
  OVERDUE_HOURS,
  SUMMARY_LOOKBACK_HOURS,
  SUMMARY_NAME_CAP,
  type EmailPayloads,
  type FailureAlertKind,
} from "@/lib/email-core";
import {
  enqueueEmails as enqueueEmailsNow,
  orgAdminRecipients,
  platformAdminRecipients,
  type EnqueueInput,
} from "@/lib/email";
import { expiryWarnings, type SubscriptionScope } from "@/lib/entitlements-core";
import { assignmentAudienceUserIds } from "@/lib/orgs";
import {
  addDays,
  dayDiff,
  dayStartUtc,
  guyanaDay,
  mondayOf,
  orgExamAlerts,
  qualifiesAsAssignmentCompletion,
  roundedMean,
} from "@/lib/orgs-core";
import { renewHref, renewPlan } from "@/lib/plans-core";
import { hasBudget } from "@/lib/reconcile-core";
import { EXPIRY_WARNING_DAYS } from "@/lib/subscriptions-core";
import type {
  NotificationPreferences,
  OrgAssignment,
  Plan,
  TestMode,
} from "@/lib/supabase/types";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Scan rows wait for the five-minute delivery job rather than sending on
 * enqueue: this runs inside the cron route's own time budget and a day's
 * reminders can be hundreds of rows. Same function, sendNow off.
 */
const enqueueEmails: (
  admin: AdminClient,
  inputs: readonly EnqueueInput[]
) => Promise<number> = (admin, inputs) =>
  enqueueEmailsNow(admin, inputs, { sendNow: false });

/**
 * The daily scan (notifications-plan.md phases 2, 4 and 6): everything that
 * is a function of the clock rather than of an action. Runs once a day from
 * /api/cron/email `{ job: "scan" }`.
 *
 * Designed for CATCH-UP like the reconcile sweep: every pass re-derives its
 * candidates from the current state and relies on the outbox's dedupe keys,
 * so a skipped day means a late reminder, never a double one. Passes are
 * independent — one failing is counted and the rest still run.
 */

export type ScanSummary = {
  durationMs: number;
  truncated: boolean;
  expiry: number;
  orgExpiry: number;
  assignmentsDueSoon: number;
  assignmentsOverdue: number;
  assignmentSummaries: number;
  digests: number;
  adminDigests: number;
  failureAlerts: number;
  /** Every pass's rows, summed as the loop runs — the one figure the admin
   * page reports, so a new pass cannot be left out of it. */
  queued: number;
  errors: number;
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const IN_CHUNK = 200;
const PAGE = 1000;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function runNotificationScan(options?: {
  budgetMs?: number;
  now?: Date;
}): Promise<ScanSummary> {
  const now = options?.now ?? new Date();
  const startedAt = Date.now();
  const deadline = startedAt + (options?.budgetMs ?? EMAIL_BUDGET_MS);
  const admin = createAdminClient();
  const summary: ScanSummary = {
    durationMs: 0,
    truncated: false,
    expiry: 0,
    orgExpiry: 0,
    assignmentsDueSoon: 0,
    assignmentsOverdue: 0,
    assignmentSummaries: 0,
    digests: 0,
    adminDigests: 0,
    failureAlerts: 0,
    queued: 0,
    errors: 0,
  };

  const passes: [keyof ScanSummary, () => Promise<number>][] = [
    ["expiry", () => scanExpiringAccess(admin, now)],
    ["orgExpiry", () => scanOrgExpiringAccess(admin, now)],
    ["assignmentsDueSoon", () => scanAssignmentsDueSoon(admin, now)],
    ["assignmentsOverdue", () => scanAssignmentsOverdue(admin, now)],
    ["assignmentSummaries", () => scanAssignmentSummaries(admin, now)],
    ["digests", () => scanWeeklyDigests(admin, now, deadline)],
    ["adminDigests", () => scanAdminDigest(admin, now)],
    ["failureAlerts", () => scanFailureAlerts(admin, now)],
  ];
  for (const [key, run] of passes) {
    if (!hasBudget(deadline, Date.now())) {
      summary.truncated = true;
      break;
    }
    try {
      const queued = await run();
      (summary[key] as number) = queued;
      summary.queued += queued;
    } catch (error) {
      summary.errors += 1;
      console.error("email_scan_pass_failed", { pass: key, error });
    }
  }

  summary.durationMs = Date.now() - startedAt;
  // Written every run, even an empty one: the heartbeat that shows the
  // daily cron is alive (payment.reconcile precedent).
  await audit(null, "email.scan", null, { ...summary });
  return summary;
}

// ── Phase 2: expiring access ────────────────────────────────

async function examNames(
  admin: AdminClient,
  examIds: readonly string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const ids of chunk([...new Set(examIds)], IN_CHUNK)) {
    const { data } = await admin.from("exams").select("id, name").in("id", ids);
    for (const e of data ?? []) out.set(e.id, e.name);
  }
  return out;
}

async function orgNames(
  admin: AdminClient,
  orgIds: readonly string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const ids of chunk([...new Set(orgIds)], IN_CHUNK)) {
    const { data } = await admin.from("orgs").select("id, name").in("id", ids);
    for (const o of data ?? []) out.set(o.id, o.name);
  }
  return out;
}

/**
 * Personal access ending within the warning window. Candidates come from a
 * windowed query, but the warning itself runs expiryWarnings over ALL of
 * each candidate's active rows — a stacked later period for the same exam
 * must suppress the reminder exactly as it suppresses the banner.
 */
async function scanExpiringAccess(admin: AdminClient, now: Date): Promise<number> {
  const windowEnd = new Date(
    now.getTime() + (EXPIRY_WARNING_DAYS + 1) * DAY_MS
  ).toISOString();
  const { data: soon, error } = await admin
    .from("subscriptions")
    .select("user_id")
    .eq("status", "active")
    .gt("current_period_end", now.toISOString())
    .lte("current_period_end", windowEnd);
  if (error) throw new Error(error.message);
  const userIds = [...new Set((soon ?? []).map((s) => s.user_id))];
  if (userIds.length === 0) return 0;

  const subsByUser = new Map<string, SubscriptionScope[]>();
  for (const ids of chunk(userIds, IN_CHUNK)) {
    const { data } = await admin
      .from("subscriptions")
      .select("user_id, status, current_period_end, exam_id")
      .in("user_id", ids)
      .eq("status", "active");
    for (const row of data ?? []) {
      const list = subsByUser.get(row.user_id) ?? [];
      list.push(row);
      subsByUser.set(row.user_id, list);
    }
  }

  const { data: planRows } = await admin
    .from("plans")
    .select("*")
    .eq("is_active", true)
    .eq("kind", "personal")
    .order("position")
    .order("name");
  const plan = renewPlan((planRows ?? []) as Plan[]);

  // Civil days in the site timezone, NOT expiryWarnings' ceil-of-hours
  // daysLeft: a period bought at 14:00 ends at 14:00, so at the 08:00 scan
  // on its last day the ceil says 1 while the mail would say "tomorrow" for
  // something ending today. Civil arithmetic makes 0 = today (no mail) and
  // 1 = tomorrow, which is what the copy promises.
  const today = guyanaDay(now);
  const pending: { userId: string; examId: string | null; periodEnd: string; daysLeft: number; stage: 7 | 1 }[] = [];
  for (const [userId, subs] of subsByUser) {
    for (const w of expiryWarnings(subs, now)) {
      const daysLeft = dayDiff(guyanaDay(new Date(w.periodEnd)), today);
      const stage = expiryReminderStage(daysLeft);
      if (stage) pending.push({ userId, examId: w.examId, periodEnd: w.periodEnd, daysLeft, stage });
    }
  }
  if (pending.length === 0) return 0;

  const names = await examNames(
    admin,
    pending.flatMap((p) => (p.examId ? [p.examId] : []))
  );
  return enqueueEmails(
    admin,
    pending.map((p) => ({
      userId: p.userId,
      template: "access_expiring" as const,
      dedupeKey: dedupeKey.expiry(p.userId, p.examId, p.periodEnd, p.stage),
      payload: {
        examName: p.examId ? (names.get(p.examId) ?? null) : null,
        endsAt: p.periodEnd,
        daysLeft: p.daysLeft,
        renewPath: renewHref(plan, p.examId),
      },
    }))
  );
}

/** Org access ending — the org-admin twin, over orgExamAlerts so the email
 * and the billing page's alert agree on which exams are "expiring". */
async function scanOrgExpiringAccess(admin: AdminClient, now: Date): Promise<number> {
  const windowEnd = new Date(
    now.getTime() + (EXPIRY_WARNING_DAYS + 1) * DAY_MS
  ).toISOString();
  const { data: soon, error } = await admin
    .from("org_subscriptions")
    .select("org_id")
    .eq("status", "active")
    .gt("current_period_end", now.toISOString())
    .lte("current_period_end", windowEnd);
  if (error) throw new Error(error.message);
  const orgIds = [...new Set((soon ?? []).map((s) => s.org_id))];
  if (orgIds.length === 0) return 0;

  const rows: EnqueueInput[] = [];
  const names = await orgNames(admin, orgIds);
  for (const orgId of orgIds) {
    const [{ data: subs }, admins] = await Promise.all([
      admin
        .from("org_subscriptions")
        .select("status, current_period_end, exam_id")
        .eq("org_id", orgId),
      orgAdminRecipients(admin, orgId),
    ]);
    if (admins.length === 0) continue;
    const alerts = orgExamAlerts(subs ?? [], now).filter((a) => a.state === "expiring");
    if (alerts.length === 0) continue;
    const exams = await examNames(admin, alerts.map((a) => a.examId));
    for (const alert of alerts) {
      // Civil days, same reasoning as the personal scan above.
      const daysLeft = dayDiff(guyanaDay(new Date(alert.endsAt)), guyanaDay(now));
      const stage = expiryReminderStage(daysLeft);
      if (!stage) continue;
      const payload: EmailPayloads["org_access_expiring"] = {
        orgId,
        orgName: names.get(orgId) ?? "your organisation",
        examName: exams.get(alert.examId) ?? "an examination",
        endsAt: alert.endsAt,
        daysLeft,
      };
      for (const adminId of admins) {
        rows.push({
          userId: adminId,
          template: "org_access_expiring",
          dedupeKey: dedupeKey.orgExpiry(orgId, alert.examId, alert.endsAt, stage, adminId),
          payload,
        });
      }
    }
  }
  return enqueueEmails(admin, rows);
}

// ── Phase 4: assignments ────────────────────────────────────

type AssignmentTestRow = {
  user_id: string;
  submitted_at: string | null;
  status: string;
  mode: TestMode;
  total_questions: number;
  answered_questions: number | null;
  score: number | null;
};

/** Every test launched from an assignment, paged past PostgREST's cap. */
async function assignmentTests(
  admin: AdminClient,
  assignmentId: string
): Promise<AssignmentTestRow[]> {
  const rows: AssignmentTestRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await admin
      .from("tests")
      .select(
        "user_id, submitted_at, status, mode, total_questions, answered_questions, score"
      )
      .eq("assignment_id", assignmentId)
      .order("id")
      .range(from, from + PAGE - 1);
    rows.push(...((data ?? []) as AssignmentTestRow[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** Latest QUALIFYING submission per member — the same completion rule the
 * org report applies (qualifiesAsAssignmentCompletion). */
function completionsOf(
  tests: readonly AssignmentTestRow[]
): Map<string, { submittedAt: string; score: number | null }> {
  const out = new Map<string, { submittedAt: string; score: number | null }>();
  for (const t of tests) {
    if (!t.submitted_at || !qualifiesAsAssignmentCompletion(t)) continue;
    const prev = out.get(t.user_id);
    if (!prev || t.submitted_at > prev.submittedAt) {
      out.set(t.user_id, { submittedAt: t.submitted_at, score: t.score });
    }
  }
  return out;
}

async function assignmentsDueBetween(
  admin: AdminClient,
  from: Date,
  to: Date
): Promise<OrgAssignment[]> {
  const { data, error } = await admin
    .from("org_assignments")
    .select("*")
    .is("deleted_at", null)
    .gt("due_at", from.toISOString())
    .lte("due_at", to.toISOString())
    .order("due_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as OrgAssignment[];
}

/** Members addressed by an assignment who have no qualifying submission. */
async function unfinishedMembers(
  admin: AdminClient,
  assignment: OrgAssignment
): Promise<{ audience: string[]; completions: Map<string, { submittedAt: string; score: number | null }> }> {
  const [audience, tests] = await Promise.all([
    assignmentAudienceUserIds(assignment),
    assignmentTests(admin, assignment.id),
  ]);
  return { audience, completions: completionsOf(tests) };
}

async function remindAssignments(
  admin: AdminClient,
  assignments: readonly OrgAssignment[],
  template: "assignment_due_soon" | "assignment_overdue"
): Promise<number> {
  if (assignments.length === 0) return 0;
  const names = await orgNames(admin, assignments.map((a) => a.org_id));
  const rows: EnqueueInput[] = [];
  for (const assignment of assignments) {
    const { audience, completions } = await unfinishedMembers(admin, assignment);
    const payload = {
      orgName: names.get(assignment.org_id) ?? "your organisation",
      title: assignment.title,
      dueAt: assignment.due_at,
    };
    for (const userId of audience) {
      if (completions.has(userId)) continue;
      rows.push({
        userId,
        template,
        dedupeKey:
          template === "assignment_due_soon"
            ? dedupeKey.assignmentDue(assignment.id, userId)
            : dedupeKey.assignmentOverdue(assignment.id, userId),
        payload,
      });
    }
  }
  return enqueueEmails(admin, rows);
}

async function scanAssignmentsDueSoon(admin: AdminClient, now: Date): Promise<number> {
  const due = await assignmentsDueBetween(
    admin,
    now,
    new Date(now.getTime() + DUE_SOON_HOURS * HOUR_MS)
  );
  return remindAssignments(admin, due, "assignment_due_soon");
}

/** One overdue mail, never a daily nag: the window is a day wide and the
 * key is per (assignment, member). */
async function scanAssignmentsOverdue(admin: AdminClient, now: Date): Promise<number> {
  const due = await assignmentsDueBetween(
    admin,
    new Date(now.getTime() - OVERDUE_HOURS * HOUR_MS),
    now
  );
  return remindAssignments(admin, due, "assignment_overdue");
}

/**
 * Closed assignments → one summary per org admin. Names and scores of
 * individual members go ONLY to admins of that org (SPEC §7's aggregate
 * model); the member-facing mails above never carry another member's data.
 */
async function scanAssignmentSummaries(admin: AdminClient, now: Date): Promise<number> {
  const closed = await assignmentsDueBetween(
    admin,
    new Date(now.getTime() - SUMMARY_LOOKBACK_HOURS * HOUR_MS),
    now
  );
  if (closed.length === 0) return 0;
  const names = await orgNames(admin, closed.map((a) => a.org_id));

  const rows: EnqueueInput[] = [];
  for (const assignment of closed) {
    const admins = await orgAdminRecipients(admin, assignment.org_id);
    if (admins.length === 0) continue;
    const { audience, completions } = await unfinishedMembers(admin, assignment);
    const cohort = new Set(audience);

    let completed = 0;
    let late = 0;
    const scores: (number | null)[] = [];
    for (const [userId, c] of completions) {
      if (!cohort.has(userId)) continue;
      completed++;
      scores.push(c.score);
      if (new Date(c.submittedAt) > new Date(assignment.due_at)) late++;
    }

    const notFinishedIds = audience.filter((id) => !completions.has(id));
    const notFinishedNames: string[] = [];
    for (const ids of chunk(notFinishedIds, IN_CHUNK)) {
      const { data } = await admin.from("profiles").select("id, full_name").in("id", ids);
      for (const p of data ?? []) {
        notFinishedNames.push(p.full_name?.trim() || "Unnamed member");
      }
    }
    notFinishedNames.sort((a, b) => a.localeCompare(b));

    const payload: EmailPayloads["assignment_summary"] = {
      orgId: assignment.org_id,
      orgName: names.get(assignment.org_id) ?? "your organisation",
      title: assignment.title,
      dueAt: assignment.due_at,
      targeted: audience.length,
      completed,
      late,
      meanPct: roundedMean(scores),
      notFinished: notFinishedNames.slice(0, SUMMARY_NAME_CAP),
      notFinishedMore: Math.max(0, notFinishedNames.length - SUMMARY_NAME_CAP),
    };
    for (const adminId of admins) {
      rows.push({
        userId: adminId,
        template: "assignment_summary",
        dedupeKey: dedupeKey.assignmentSummary(assignment.id, adminId),
        payload,
      });
    }
  }
  return enqueueEmails(admin, rows);
}

// ── Phase 6: weekly digest ──────────────────────────────────

/**
 * Opt-in only, active users only: someone who answered nothing last week
 * gets no mail (a "we missed you" is a product decision for later). Five
 * small reads per user rather than one wide join — the opt-in default of
 * OFF keeps the population small.
 *
 * Runs EVERY day for the last completed week, not Mondays only: the key is
 * per (user, week), so Monday's run mails almost everyone once and any run
 * the budget cut short is finished on Tuesday rather than lost for the
 * week. Someone who opts in mid-week gets last week's recap once.
 */
async function scanWeeklyDigests(
  admin: AdminClient,
  now: Date,
  deadline: number
): Promise<number> {
  const today = guyanaDay(now);
  // Monday of the week before today's, whichever weekday today is.
  const weekStart = mondayOf(addDays(today, -7));
  const weekEnd = addDays(weekStart, 6);
  const since = dayStartUtc(weekStart);
  const until = dayStartUtc(addDays(weekStart, 7));
  const weekLabel = `${formatDay(weekStart)} – ${formatDay(weekEnd)}`;

  const optedIn: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await admin
      .from("notification_preferences")
      .select("user_id")
      .eq("weekly_digest", true)
      .order("user_id")
      .range(from, from + PAGE - 1);
    optedIn.push(...((data ?? []) as Pick<NotificationPreferences, "user_id">[]).map((r) => r.user_id));
    if (!data || data.length < PAGE) break;
  }

  let queued = 0;
  for (const userId of optedIn) {
    if (!hasBudget(deadline, Date.now())) break;

    const [{ count: attempts }, { count: correct }] = await Promise.all([
      admin
        .from("attempts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("answered_at", since)
        .lt("answered_at", until),
      admin
        .from("attempts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_correct", true)
        .gte("answered_at", since)
        .lt("answered_at", until),
    ]);
    if (!attempts) continue;

    const [{ data: days }, { data: weak }, { data: planSettings }] = await Promise.all([
      admin
        .from("user_daily_activity")
        .select("day")
        .eq("user_id", userId)
        .order("day", { ascending: false })
        .limit(400),
      admin
        .from("subject_accuracy")
        .select("subject_name, accuracy_pct")
        .eq("user_id", userId)
        .gte("attempts", DIGEST_SUBJECT_MIN_ATTEMPTS)
        .order("accuracy_pct", { ascending: true })
        .limit(DIGEST_WEAK_SUBJECTS),
      // A settings row is what says "this student uses the plan"; the week
      // itself is generated lazily on their first visit, so it rarely exists
      // at 08:00 Monday and would read false for almost everyone.
      admin
        .from("study_plan_settings")
        .select("user_id")
        .eq("user_id", userId)
        .limit(1),
    ]);

    const payload: EmailPayloads["weekly_digest"] = {
      weekLabel,
      attempts,
      correct: correct ?? 0,
      accuracyPct: Math.round(((correct ?? 0) / attempts) * 100),
      // Seeded from the site-timezone day, matching how the view buckets.
      streak: calculateStreak((days ?? []).map((d) => d.day as string), today),
      weakSubjects: (weak ?? []).map((s) => ({
        name: s.subject_name,
        accuracyPct: Math.round(s.accuracy_pct),
      })),
      hasPlan: (planSettings?.length ?? 0) > 0,
    };
    queued += await enqueueEmails(admin, [
      {
        userId,
        template: "weekly_digest",
        dedupeKey: dedupeKey.digest(userId, weekStart),
        payload,
      },
    ]);
  }
  return queued;
}

/** "1 Sept" for the digest's week label. */
function formatDay(day: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(new Date(`${day}T00:00:00Z`));
}

// ── Platform admins ─────────────────────────────────────────

/**
 * The daily queue digest: what came in over the last day and what is still
 * waiting. Silent when every figure is zero — the email.scan audit row is
 * the heartbeat, not an email that says "nothing".
 */
async function scanAdminDigest(admin: AdminClient, now: Date): Promise<number> {
  const admins = await platformAdminRecipients(admin);
  if (admins.length === 0) return 0;
  const since = new Date(now.getTime() - DAY_MS).toISOString();

  const [
    { count: newMessages },
    { count: openMessages },
    { count: newReports },
    { data: openReportQuestions },
    { count: pendingReviews },
  ] = await Promise.all([
    admin
      .from("contact_messages")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since),
    admin
      .from("contact_messages")
      .select("id", { count: "exact", head: true })
      .is("handled_at", null),
    admin
      .from("question_reports")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since),
    // Platform scope, questions not reports — the same figure as the nav badge.
    admin.rpc("open_report_question_count", { p_org_id: null }),
    admin
      .from("site_reviews")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  const payload: EmailPayloads["admin_daily_digest"] = {
    dayLabel: formatDateLong(now.toISOString()),
    newMessages: newMessages ?? 0,
    openMessages: openMessages ?? 0,
    newReports: newReports ?? 0,
    openReportQuestions: openReportQuestions ?? 0,
    pendingReviews: pendingReviews ?? 0,
  };
  if (!adminDigestWorthSending(payload)) return 0;

  const day = guyanaDay(now);
  return enqueueEmails(
    admin,
    admins.map((adminId) => ({
      userId: adminId,
      template: "admin_daily_digest" as const,
      dedupeKey: dedupeKey.adminDigest(day, adminId),
      payload,
    }))
  );
}

/**
 * OpenAI failure alerts. Both the OSCE judge and the translator fail
 * quietly per request (the student sees "unavailable" and retries), so
 * nothing else notices a dead key or an exhausted quota. One alert per
 * kind per day once the trailing-window count reaches the threshold.
 */
async function scanFailureAlerts(admin: AdminClient, now: Date): Promise<number> {
  const admins = await platformAdminRecipients(admin);
  if (admins.length === 0) return 0;
  const since = new Date(
    now.getTime() - FAILURE_ALERT_WINDOW_HOURS * HOUR_MS
  ).toISOString();

  const [
    { count: osceFailures },
    { count: osceCalls },
    { count: translationFailures },
    { count: translationCalls },
  ] = await Promise.all([
    admin
      .from("osce_grading_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since)
      .not("error", "is", null),
    admin
      .from("osce_grading_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since),
    admin
      .from("translation_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since)
      .eq("ok", false),
    admin
      .from("translation_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since),
  ]);

  const kinds: { kind: FailureAlertKind; failures: number; calls: number; logPath: string }[] = [
    {
      kind: "osce_grading",
      failures: osceFailures ?? 0,
      calls: osceCalls ?? 0,
      logPath: "/admin/osce",
    },
    {
      kind: "translation",
      failures: translationFailures ?? 0,
      calls: translationCalls ?? 0,
      logPath: "/admin/translations",
    },
  ];

  const day = guyanaDay(now);
  const rows: EnqueueInput[] = [];
  for (const k of kinds) {
    if (!failureAlertDue(k.failures)) continue;
    const payload: EmailPayloads["admin_failure_alert"] = {
      kind: k.kind,
      failures: k.failures,
      calls: k.calls,
      windowHours: FAILURE_ALERT_WINDOW_HOURS,
      threshold: FAILURE_ALERT_THRESHOLD,
      logPath: k.logPath,
    };
    for (const adminId of admins) {
      rows.push({
        userId: adminId,
        template: "admin_failure_alert",
        dedupeKey: dedupeKey.adminFailure(k.kind, day, adminId),
        payload,
      });
    }
  }
  return enqueueEmails(admin, rows);
}
