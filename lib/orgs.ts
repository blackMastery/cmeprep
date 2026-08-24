import "server-only";

import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, requireUser, type SessionUser } from "@/lib/auth";
import { orgAccessOf } from "@/lib/entitlements-core";
import { planAdherenceForMembers, type MemberPlanAdherence } from "@/lib/plan";
import {
  assignmentStatus,
  countsTowardDeptAssignment,
  isInvitePending,
  memberReadiness,
  orgHeadline,
  qualifiesAsAssignmentCompletion,
  readinessWindowStart,
  sittingFraming,
  type AssignmentStatus,
  type MemberReadiness,
  type MemberReadinessInput,
  type OrgHeadline,
  type SittingFraming,
  type WeeklyModeBucket,
} from "@/lib/orgs-core";
import type {
  Org,
  OrgAssignment,
  OrgDepartment,
  OrgInvite,
  OrgMember,
  OrgSubscription,
  Profile,
  TestMode,
} from "@/lib/supabase/types";

/**
 * DB layer for org accounts. Everything here runs on the service-role client,
 * so every function takes or derives an org id and scopes with `.eq()` —
 * with RLS bypassed those filters are the only wall.
 */

export type OrgMembershipContext = {
  org: Org;
  membership: OrgMember;
};

/** The caller's org, if any. One org per user in v1 (unique on user_id). */
export async function getOrgMembership(
  userId: string
): Promise<OrgMembershipContext | null> {
  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("org_members")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return null;

  const { data: org } = await admin
    .from("orgs")
    .select("*")
    .eq("id", membership.org_id)
    .maybeSingle();
  // A membership pointing at a missing org row grants nothing.
  if (!org) return null;

  return { org: org as Org, membership: membership as OrgMember };
}

export type OrgAdminSession = OrgMembershipContext & { user: SessionUser };

/**
 * Gate for the org-admin area and every org-admin Server Action. Call as the
 * FIRST statement, outside try/catch — requireUser() signals by throwing
 * NEXT_REDIRECT, which a catch block would swallow.
 *
 * Deliberately does NOT block on suspension or a lapsed subscription:
 * org-admins must still reach members/billing to fix exactly those states.
 * Pages show the banners; the entitlement lock lives in orgs-core.
 */
export async function requireOrgAdmin(): Promise<OrgAdminSession> {
  const user = await requireUser();
  const ctx = await getOrgMembership(user.id);
  if (!ctx || ctx.membership.role !== "admin") redirect("/dashboard");
  return { user, ...ctx };
}

/**
 * Org-admin gate for ROUTE HANDLERS (SPEC §12): JSON 401/403 instead of the
 * redirect requireOrgAdmin() signals with — a fetch client would only be
 * confused by a 307. Mirrors requireAdminJson in lib/admin/api-auth.ts.
 */
export async function requireOrgAdminJson(): Promise<
  { session: OrgAdminSession } | { response: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      response: NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      ),
    };
  }
  const ctx = await getOrgMembership(user.id);
  if (!ctx || ctx.membership.role !== "admin") {
    return {
      response: NextResponse.json(
        { error: "Organisation admin access required" },
        { status: 403 }
      ),
    };
  }
  return { session: { user, ...ctx } };
}

export type OrgMemberRow = {
  member: OrgMember;
  profile: Profile | null;
  email: string | null;
};

/** Roster, admins first then longest-serving first — stable for review. */
export async function listOrgMembers(orgId: string): Promise<OrgMemberRow[]> {
  const admin = createAdminClient();

  const { data: members } = await admin
    .from("org_members")
    .select("*")
    .eq("org_id", orgId)
    .order("joined_at", { ascending: true });

  const rows = (members ?? []) as OrgMember[];
  if (rows.length === 0) return [];

  const ids = rows.map((m) => m.user_id);
  const [{ data: profiles }, { data: emails }] = await Promise.all([
    admin.from("profiles").select("*").in("id", ids),
    admin.from("user_emails").select("id, email").in("id", ids),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p as Profile]));
  const emailById = new Map((emails ?? []).map((e) => [e.id, e.email]));

  return rows
    .map((member) => ({
      member,
      profile: profileById.get(member.user_id) ?? null,
      email: emailById.get(member.user_id) ?? null,
    }))
    .sort(
      (a, b) =>
        Number(b.member.role === "admin") - Number(a.member.role === "admin")
    );
}

/** An org's departments, alphabetical — the order every picker shows. */
export async function listOrgDepartments(
  orgId: string
): Promise<OrgDepartment[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("org_departments")
    .select("*")
    .eq("org_id", orgId)
    .order("name", { ascending: true });
  return (data ?? []) as OrgDepartment[];
}

/** One department, org-scoped — the member-facing label lookup. */
export async function getOrgDepartment(
  orgId: string,
  departmentId: string
): Promise<OrgDepartment | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("org_departments")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", departmentId)
    .maybeSingle();
  return (data as OrgDepartment | null) ?? null;
}

/**
 * Invites that still matter: pending ones (occupying seats) and expired ones
 * (re-sendable). Accepted rows became members; revoked rows are noise.
 */
export async function listOrgInvites(orgId: string): Promise<OrgInvite[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("org_invites")
    .select("*")
    .eq("org_id", orgId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  return (data ?? []) as OrgInvite[];
}

export type OrgSeatUsage = {
  members: number;
  pendingInvites: number;
  seatLimit: number;
};

/** Inputs for the strict seat rule: members + pending invites ≤ limit. */
export async function getOrgSeatUsage(
  org: Org,
  now: Date = new Date()
): Promise<OrgSeatUsage> {
  const admin = createAdminClient();
  const [{ count: members }, invites] = await Promise.all([
    admin
      .from("org_members")
      .select("user_id", { count: "exact", head: true })
      .eq("org_id", org.id),
    listOrgInvites(org.id),
  ]);

  return {
    members: members ?? 0,
    pendingInvites: invites.filter((i) => isInvitePending(i, now)).length,
    seatLimit: org.seat_limit,
  };
}

/** All of an org's subscription rows, newest period first. */
export async function listOrgSubscriptions(
  orgId: string
): Promise<OrgSubscription[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("org_subscriptions")
    .select("*")
    .eq("org_id", orgId)
    .order("current_period_end", { ascending: false });
  return (data ?? []) as OrgSubscription[];
}

/** Live (non-deleted) assignments, soonest deadline first. */
export async function listOrgAssignments(
  orgId: string
): Promise<OrgAssignment[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("org_assignments")
    .select("*")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .order("due_at", { ascending: true });
  return (data ?? []) as OrgAssignment[];
}

export type MemberAssignment = {
  assignment: OrgAssignment;
  status: AssignmentStatus;
  /** Latest attempt, submitted or not — where Continue/Review point. */
  latestTestId: string | null;
  latestScore: number | null;
  latestTotal: number | null;
  /** Mode of the qualifying completion — members may override the
   * prescribed mode, and the report labels what was actually done. */
  completedMode: TestMode | null;
};

/**
 * What one member owes (or has done): assignments addressed to them plus
 * their standing on each, derived from their tests via assignment_id.
 *
 * Callers that already hold the membership row (both pages fetch it via
 * getOrgMembership immediately before) pass it as `member` to skip a
 * redundant org_members read.
 */
export async function assignmentsForMember(
  orgId: string,
  userId: string,
  member?: Pick<OrgMember, "department_id" | "department_changed_at">,
  now: Date = new Date()
): Promise<MemberAssignment[]> {
  const admin = createAdminClient();

  const [assignments, { data: targetRows }, membershipRes] = await Promise.all([
    listOrgAssignments(orgId),
    admin
      .from("org_assignment_targets")
      .select("assignment_id")
      .eq("user_id", userId),
    member
      ? Promise.resolve(null)
      : admin
          .from("org_members")
          .select("department_id, department_changed_at")
          .eq("org_id", orgId)
          .eq("user_id", userId)
          .maybeSingle(),
  ]);
  const targeted = new Set((targetRows ?? []).map((t) => t.assignment_id));
  const deptMember = member ??
    ((membershipRes?.data ?? null) as Pick<
      OrgMember,
      "department_id" | "department_changed_at"
    > | null) ?? { department_id: null, department_changed_at: null };
  // Department audiences use the completion-cohort rule, not a bare id
  // match, so a member moved in after the deadline never sees the
  // assignment they would otherwise instantly be "overdue" on.
  const mine = assignments.filter(
    (a) =>
      a.audience === "all" ||
      targeted.has(a.id) ||
      (a.audience === "department" && countsTowardDeptAssignment(deptMember, a))
  );
  if (mine.length === 0) return [];

  const { data: tests } = await admin
    .from("tests")
    .select(
      "id, assignment_id, status, mode, submitted_at, score, total_questions, answered_questions"
    )
    .eq("user_id", userId)
    .in(
      "assignment_id",
      mine.map((a) => a.id)
    )
    .order("started_at", { ascending: false });

  type TestRow = {
    id: string;
    assignment_id: string | null;
    status: string;
    mode: TestMode;
    submitted_at: string | null;
    score: number | null;
    total_questions: number;
    answered_questions: number | null;
  };
  const byAssignment = new Map<string, TestRow[]>();
  for (const t of (tests ?? []) as TestRow[]) {
    if (!t.assignment_id) continue;
    const list = byAssignment.get(t.assignment_id) ?? [];
    list.push(t);
    byAssignment.set(t.assignment_id, list);
  }

  return mine.map((assignment) => {
    const attempts = byAssignment.get(assignment.id) ?? [];
    // Submitted is not enough anymore: a tutor session finished with skipped
    // questions does NOT satisfy the assignment (SPEC §7) — the member's
    // standing stays in_progress until a fully-answered run is submitted.
    const qualifying = attempts.filter((t) => qualifiesAsAssignmentCompletion(t));
    // Latest by SUBMITTED time, not the started_at order of the query:
    // indefinitely-resumable tutor sessions submit out of start order, and
    // listAssignmentProgress compares submitted_at — the two surfaces must
    // report the same run (SPEC §7).
    const latestQualifying = qualifying.reduce<TestRow | null>(
      (best, t) =>
        best === null || (t.submitted_at ?? "") > (best.submitted_at ?? "")
          ? t
          : best,
      null
    );
    const latest = latestQualifying ?? attempts[0] ?? null;

    return {
      assignment,
      status: assignmentStatus(
        {
          dueAt: assignment.due_at,
          submittedAt: latestQualifying?.submitted_at ?? null,
          // A submitted-but-unqualifying tutor run must NOT hold the status
          // at in_progress — with nothing left to resume it would mask
          // "overdue" forever. Only live runs (and qualifying ones, handled
          // via submittedAt above) count as an attempt in flight.
          hasAttempt: attempts.some(
            (t) =>
              t.status === "in_progress" || qualifiesAsAssignmentCompletion(t)
          ),
        },
        now
      ),
      latestTestId: latest?.id ?? null,
      latestScore: latestQualifying?.score ?? null,
      latestTotal: latestQualifying?.total_questions ?? null,
      completedMode: latestQualifying?.mode ?? null,
    };
  });
}

export type AssignmentProgress = {
  assignment: OrgAssignment;
  targeted: number;
  completed: number;
  late: number;
  /** Of `completed`, how many were done in tutor mode — the override is
   * allowed and counts, but the report labels it (SPEC §7). */
  completedTutor: number;
  /** For department audiences: the department's name, or null when it was
   * hard-deleted — render "Department deleted". Null on other audiences. */
  departmentName: string | null;
  /** Distinct members with ANY test on this assignment, submitted or not.
   * Non-zero locks the prescription against edits (assignmentEditBlocker). */
  started: number;
  /** Current target user ids (audience='selected' only) — the edit form's
   * pre-ticked members. */
  targetIds: string[];
};

/** Per-assignment completion counts for the org-admin list. */
export async function listAssignmentProgress(
  orgId: string
): Promise<AssignmentProgress[]> {
  const admin = createAdminClient();
  const assignments = await listOrgAssignments(orgId);
  if (assignments.length === 0) return [];
  const ids = assignments.map((a) => a.id);

  const [{ count: memberCount }, { data: targets }, { data: tests }] =
    await Promise.all([
      admin
        .from("org_members")
        .select("user_id", { count: "exact", head: true })
        .eq("org_id", orgId),
      admin
        .from("org_assignment_targets")
        .select("assignment_id, user_id")
        .in("assignment_id", ids),
      admin
        .from("tests")
        .select(
          "assignment_id, user_id, submitted_at, status, mode, total_questions, answered_questions"
        )
        .in("assignment_id", ids),
    ]);

  // Department cohorts need each member's department_id + changed_at, plus
  // the department names — fetched only when some assignment actually has a
  // department audience, so the common case pays nothing extra. The 'all'
  // denominator uses the exact head-count above either way: a row-returning
  // roster select is capped by PostgREST max_rows (1000), the count is not.
  let members: Pick<
    OrgMember,
    "user_id" | "department_id" | "department_changed_at"
  >[] = [];
  let departmentName = new Map<string, string>();
  if (assignments.some((a) => a.audience === "department")) {
    const departments = await listOrgDepartments(orgId);
    departmentName = new Map(departments.map((d) => [d.id, d.name]));
    // Paged like getOrgDashboard's attempts read: a plain row select is
    // capped by PostgREST max_rows (1000), which would silently drop the
    // members of a >1000-seat org from BOTH sides of the completion rate.
    const ROSTER_PAGE = 1000;
    for (let from = 0; ; from += ROSTER_PAGE) {
      const { data: page } = await admin
        .from("org_members")
        .select("user_id, department_id, department_changed_at")
        .eq("org_id", orgId)
        .order("user_id")
        .range(from, from + ROSTER_PAGE - 1);
      members = members.concat((page ?? []) as typeof members);
      if (!page || page.length < ROSTER_PAGE) break;
    }
  }

  const targetIdsOf = new Map<string, string[]>();
  for (const t of targets ?? []) {
    const list = targetIdsOf.get(t.assignment_id) ?? [];
    list.push(t.user_id);
    targetIdsOf.set(t.assignment_id, list);
  }

  // Every status counts as "started" — an in-progress attempt is enough to
  // lock the config, since that member's test already snapshotted it.
  const startedBy = new Map<string, Set<string>>();
  for (const t of tests ?? []) {
    if (!t.assignment_id) continue;
    const set = startedBy.get(t.assignment_id) ?? new Set<string>();
    set.add(t.user_id);
    startedBy.set(t.assignment_id, set);
  }

  // One completion per member per assignment; latest QUALIFYING submission
  // decides late (an incomplete tutor run doesn't count at all — see
  // qualifiesAsAssignmentCompletion). Mode rides along for the report label.
  const submittedBy = new Map<
    string,
    Map<string, { submittedAt: string; mode: TestMode }>
  >();
  for (const t of tests ?? []) {
    if (!t.assignment_id || !t.submitted_at) continue;
    // qualifies… also requires status='submitted', which the read above no
    // longer filters on (it now feeds `started` too).
    if (!qualifiesAsAssignmentCompletion(t)) continue;
    const perUser =
      submittedBy.get(t.assignment_id) ??
      new Map<string, { submittedAt: string; mode: TestMode }>();
    const prev = perUser.get(t.user_id);
    if (!prev || t.submitted_at > prev.submittedAt) {
      perUser.set(t.user_id, { submittedAt: t.submitted_at, mode: t.mode });
    }
    submittedBy.set(t.assignment_id, perUser);
  }

  return assignments.map((assignment) => {
    // Department audiences count only the current cohort — transfers-out
    // drop from numerator AND denominator, so rates never exceed 100%.
    const cohort =
      assignment.audience === "department"
        ? new Set(
            members
              .filter((m) => countsTowardDeptAssignment(m, assignment))
              .map((m) => m.user_id)
          )
        : null;

    const perUser =
      submittedBy.get(assignment.id) ??
      new Map<string, { submittedAt: string; mode: TestMode }>();
    let completed = 0;
    let late = 0;
    let completedTutor = 0;
    for (const [userId, completion] of perUser) {
      if (cohort !== null && !cohort.has(userId)) continue;
      completed++;
      if (completion.mode === "tutor") completedTutor++;
      if (new Date(completion.submittedAt) > new Date(assignment.due_at)) late++;
    }

    return {
      assignment,
      targeted:
        assignment.audience === "all"
          ? (memberCount ?? 0)
          : cohort !== null
            ? cohort.size
            : (targetIdsOf.get(assignment.id)?.length ?? 0),
      completed,
      late,
      completedTutor,
      departmentName:
        assignment.department_id !== null
          ? (departmentName.get(assignment.department_id) ?? null)
          : null,
      started: startedBy.get(assignment.id)?.size ?? 0,
      targetIds: targetIdsOf.get(assignment.id) ?? [],
    };
  });
}

export type OrgMemberStats = {
  member: OrgMember;
  name: string | null;
  email: string | null;
  attempted: number;
  readiness: MemberReadiness;
  lastActiveDay: string | null;
  assignmentsCompleted: number;
  /** Study-plan visibility (SPEC §17): this derived pair is ALL an org sees —
   * goals, intensity and personal sitting dates stay private. */
  planAdherencePct: number | null;
  hasActivePlan: boolean;
};

export type OrgReadinessDashboard = {
  examId: string;
  /** Framing only — the sitting date never moves scores or bands. */
  sitting: SittingFraming | null;
  members: OrgMemberStats[];
  headline: OrgHeadline;
};

export type EntitledExam = {
  id: string;
  name: string;
  /** From org_exam_dates; null = no sitting date set. */
  sittingOn: string | null;
};

/** Split ids so every `.in(...)` read stays far below PostgREST's 1000-row
 * response cap — bounded responses instead of silent truncation. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const MEMBER_CHUNK = 30;

/**
 * Exams the org's readiness can be measured against: every public exam its
 * plan currently grants (orgAccessOf owns that rule) plus its own private
 * bank. Sitting dates ride along; soonest-dated exam first, so index 0 is
 * the dashboard's default.
 */
export async function listOrgEntitledExams(
  org: Org,
  now: Date = new Date()
): Promise<EntitledExam[]> {
  const admin = createAdminClient();
  const [subs, { data: exams }, { data: dates }] = await Promise.all([
    listOrgSubscriptions(org.id),
    admin
      .from("exams")
      .select("id, name, org_id")
      .or(`org_id.eq.${org.id},org_id.is.null`),
    admin
      .from("org_exam_dates")
      .select("exam_id, sitting_on")
      .eq("org_id", org.id),
  ]);
  const access = orgAccessOf(
    { org_id: org.id, suspended_at: org.suspended_at, subs },
    now
  );
  const sittingByExam = new Map(
    (dates ?? []).map((d) => [d.exam_id, d.sitting_on as string])
  );

  return (exams ?? [])
    .filter(
      (e) =>
        e.org_id === org.id || // the org's own bank is always theirs to measure
        (access !== null &&
          (access.allAccess || access.examIds.includes(e.id)))
    )
    .map((e) => ({
      id: e.id,
      name: e.name as string,
      sittingOn: sittingByExam.get(e.id) ?? null,
    }))
    .sort((a, b) => {
      if (a.sittingOn !== b.sittingOn) {
        if (a.sittingOn === null) return 1;
        if (b.sittingOn === null) return -1;
        return a.sittingOn.localeCompare(b.sittingOn);
      }
      return a.name.localeCompare(b.name);
    });
}

/**
 * The program-director view (SPEC §8 v2): per-member readiness for ONE exam,
 * from AGGREGATES only — the four readiness views, subject_accuracy, and
 * test scores. Deliberately no path from here to answers, notes, bookmarks
 * or question-level review. RLS is bypassed (admin client), so the
 * `.in("user_id")` / `.eq("exam_id")` filters are the wall.
 */
export async function getOrgReadinessDashboard(
  org: Org,
  examId: string,
  now: Date = new Date()
): Promise<OrgReadinessDashboard> {
  const admin = createAdminClient();
  const [members, { data: dateRow }, { data: roster }] = await Promise.all([
    listOrgMembers(org.id),
    admin
      .from("org_exam_dates")
      .select("sitting_on")
      .eq("org_id", org.id)
      .eq("exam_id", examId)
      .maybeSingle(),
    admin.from("exam_subject_counts").select("*").eq("exam_id", examId),
  ]);
  const sitting = sittingFraming(dateRow?.sitting_on ?? null, now);
  if (members.length === 0) {
    return {
      examId,
      sitting,
      members: [],
      headline: orgHeadline([], now),
    };
  }

  const windowStart = readinessWindowStart(now); // Monday, America/Guyana
  // Close enough for "a mock in the window": the exact Guyana midnight is 4h
  // off UTC and the window opens on a week boundary anyway.
  const windowStartTs = `${windowStart}T00:00:00Z`;

  type SubjectStat = { attempts: number; accuracyPct: number | null };
  const weeklyByUser = new Map<string, WeeklyModeBucket[]>();
  const activityByUser = new Map<string, { weekStart: string; days: number }[]>();
  const totalsByUser = new Map<
    string,
    { attempts: number; correct: number; lastActiveDay: string }
  >();
  const subjectsByUser = new Map<string, Map<string, SubjectStat>>();
  const hasMock = new Set<string>();
  const completed = new Map<string, Set<string>>();
  const planByUser = new Map<string, MemberPlanAdherence>();

  for (const ids of chunk(members.map((m) => m.member.user_id), MEMBER_CHUNK)) {
    const [
      { data: weekly },
      { data: activity },
      { data: totals },
      { data: subjectRows },
      { data: mockRows },
      planAdherence,
    ] = await Promise.all([
      admin
        .from("user_exam_weekly_mode_accuracy")
        .select("user_id, week_start, mode, attempts, correct")
        .in("user_id", ids)
        .eq("exam_id", examId)
        .gte("week_start", windowStart),
      admin
        .from("user_exam_weekly_activity")
        .select("user_id, week_start, active_days")
        .in("user_id", ids)
        .eq("exam_id", examId)
        .gte("week_start", windowStart),
      admin
        .from("user_exam_stats")
        .select("user_id, attempts, correct, last_active_day")
        .in("user_id", ids)
        .eq("exam_id", examId),
      admin
        .from("subject_accuracy")
        .select("user_id, subject_id, attempts, accuracy_pct")
        .in("user_id", ids)
        .eq("exam_id", examId),
      // The timed-mock cap keys off completed exam-mode TESTS — legacy
      // null-test_id attempts count as exam-mode in the views but cannot
      // satisfy this. config->>exam_id is unindexed JSON-path; fine here
      // because user_id narrows first (never use it unnarrowed at scale).
      admin
        .from("tests")
        .select("user_id")
        .in("user_id", ids)
        .eq("mode", "exam")
        .eq("status", "submitted")
        .eq("config->>exam_id", examId)
        .gte("submitted_at", windowStartTs),
      planAdherenceForMembers(examId, ids, now),
    ]);

    for (const [id, adherence] of planAdherence) planByUser.set(id, adherence);

    for (const r of weekly ?? []) {
      const list = weeklyByUser.get(r.user_id) ?? [];
      list.push({
        weekStart: r.week_start,
        mode: r.mode as TestMode,
        attempts: r.attempts,
        correct: r.correct,
      });
      weeklyByUser.set(r.user_id, list);
    }
    for (const r of activity ?? []) {
      const list = activityByUser.get(r.user_id) ?? [];
      list.push({ weekStart: r.week_start, days: r.active_days });
      activityByUser.set(r.user_id, list);
    }
    for (const r of totals ?? []) {
      totalsByUser.set(r.user_id, {
        attempts: r.attempts,
        correct: r.correct,
        lastActiveDay: r.last_active_day,
      });
    }
    for (const r of subjectRows ?? []) {
      const map = subjectsByUser.get(r.user_id) ?? new Map<string, SubjectStat>();
      map.set(r.subject_id, {
        attempts: r.attempts,
        accuracyPct: r.accuracy_pct === null ? null : Number(r.accuracy_pct),
      });
      subjectsByUser.set(r.user_id, map);
    }
    for (const r of mockRows ?? []) hasMock.add(r.user_id);

    // Assignment completions: paged inside the chunk so a heavy cohort can
    // never silently truncate at PostgREST's cap.
    for (let from = 0; ; from += 1000) {
      const { data: page } = await admin
        .from("tests")
        .select("user_id, assignment_id, org_assignments!inner(org_id)")
        .in("user_id", ids)
        .eq("status", "submitted")
        .eq("org_assignments.org_id", org.id)
        .not("assignment_id", "is", null)
        .order("id")
        .range(from, from + 999);
      for (const t of page ?? []) {
        if (!t.assignment_id) continue;
        const set = completed.get(t.user_id) ?? new Set<string>();
        set.add(t.assignment_id);
        completed.set(t.user_id, set);
      }
      if (!page || page.length < 1000) break;
    }
  }

  const subjectRoster = (roster ?? []).map((s) => ({
    subjectId: s.subject_id,
    questionCount: s.question_count,
  }));

  const rows: OrgMemberStats[] = members.map((row) => {
    const id = row.member.user_id;
    const totals = totalsByUser.get(id);
    const userSubjects = subjectsByUser.get(id);
    const input: MemberReadinessInput = {
      passMarkPct: org.pass_mark_pct,
      inactivityDays: org.risk_inactivity_days,
      weekly: weeklyByUser.get(id) ?? [],
      weeklyActiveDays: activityByUser.get(id) ?? [],
      allTime: {
        attempts: totals?.attempts ?? 0,
        correct: totals?.correct ?? 0,
      },
      // The FULL exam roster — untouched subjects count against coverage.
      subjects: subjectRoster.map((s) => ({
        subjectId: s.subjectId,
        questionCount: s.questionCount,
        attempts: userSubjects?.get(s.subjectId)?.attempts ?? 0,
        accuracyPct: userSubjects?.get(s.subjectId)?.accuracyPct ?? null,
      })),
      hasExamModeTestInWindow: hasMock.has(id),
      lastActiveDay: totals?.lastActiveDay ?? null,
      joinedAt: row.member.joined_at,
    };
    return {
      member: row.member,
      name: row.profile?.full_name ?? null,
      email: row.email,
      attempted: totals?.attempts ?? 0,
      readiness: memberReadiness(input, now),
      lastActiveDay: totals?.lastActiveDay ?? null,
      assignmentsCompleted: completed.get(id)?.size ?? 0,
      planAdherencePct: planByUser.get(id)?.adherencePct ?? null,
      hasActivePlan: planByUser.get(id)?.hasActivePlan ?? false,
    };
  });

  return { examId, sitting, members: rows, headline: orgHeadline(rows, now) };
}

export type MemberReadinessDetail = {
  member: OrgMember;
  name: string | null;
  email: string | null;
  readiness: MemberReadiness;
  sitting: SittingFraming | null;
  attempted: number;
  lastActiveDay: string | null;
  subjects: {
    subjectId: string;
    subjectName: string;
    questionCount: number;
    attempts: number;
    accuracyPct: number | null;
  }[];
  /** One entry per window week, oldest first (zero-filled). */
  weeklyActivity: { weekStart: string; days: number }[];
  /** Submitted exam-mode tests, newest first — scores and counts ONLY. */
  mockHistory: {
    id: string;
    score: number | null;
    submittedAt: string | null;
    totalQuestions: number;
    answeredQuestions: number | null;
  }[];
  /** Display only (SPEC §8 v2) — pacing never feeds the score. */
  pacingSecPerQuestion: number | null;
  /** Study-plan visibility (SPEC §17) — the derived pair only. */
  planAdherencePct: number | null;
  hasActivePlan: boolean;
};

/**
 * One member's readiness breakdown for the drill-down page. Same privacy
 * boundary as the dashboard: aggregates and test scores only, never answers.
 */
export async function getMemberReadinessDetail(
  org: Org,
  userId: string,
  examId: string,
  now: Date = new Date()
): Promise<MemberReadinessDetail | null> {
  const admin = createAdminClient();

  // RLS is bypassed — this membership check IS the wall between orgs.
  const { data: membership } = await admin
    .from("org_members")
    .select("*")
    .eq("org_id", org.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return null;
  const member = membership as OrgMember;

  const windowStart = readinessWindowStart(now);
  const windowStartTs = `${windowStart}T00:00:00Z`;

  const [
    { data: profile },
    { data: emailRow },
    { data: weekly },
    { data: activity },
    { data: totals },
    { data: subjectRows },
    { data: roster },
    { data: mocks },
    { data: dateRow },
    planAdherenceMap,
  ] = await Promise.all([
    admin.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    admin.from("user_emails").select("email").eq("id", userId).maybeSingle(),
    admin
      .from("user_exam_weekly_mode_accuracy")
      .select("week_start, mode, attempts, correct, time_spent_sec, timed_attempts")
      .eq("user_id", userId)
      .eq("exam_id", examId)
      .gte("week_start", windowStart),
    admin
      .from("user_exam_weekly_activity")
      .select("week_start, active_days")
      .eq("user_id", userId)
      .eq("exam_id", examId)
      .gte("week_start", windowStart),
    admin
      .from("user_exam_stats")
      .select("attempts, correct, last_active_day")
      .eq("user_id", userId)
      .eq("exam_id", examId)
      .maybeSingle(),
    admin
      .from("subject_accuracy")
      .select("subject_id, attempts, accuracy_pct")
      .eq("user_id", userId)
      .eq("exam_id", examId),
    admin.from("exam_subject_counts").select("*").eq("exam_id", examId),
    admin
      .from("tests")
      .select("id, score, submitted_at, total_questions, answered_questions")
      .eq("user_id", userId)
      .eq("mode", "exam")
      .eq("status", "submitted")
      .eq("config->>exam_id", examId)
      .order("submitted_at", { ascending: false })
      .limit(20),
    admin
      .from("org_exam_dates")
      .select("sitting_on")
      .eq("org_id", org.id)
      .eq("exam_id", examId)
      .maybeSingle(),
    planAdherenceForMembers(examId, [userId], now),
  ]);
  const planAdherence = planAdherenceMap.get(userId);

  const weeklyBuckets: WeeklyModeBucket[] = (weekly ?? []).map((r) => ({
    weekStart: r.week_start,
    mode: r.mode as TestMode,
    attempts: r.attempts,
    correct: r.correct,
  }));
  const subjectStat = new Map(
    (subjectRows ?? []).map((r) => [
      r.subject_id,
      {
        attempts: r.attempts,
        accuracyPct: r.accuracy_pct === null ? null : Number(r.accuracy_pct),
      },
    ])
  );
  const subjects = (roster ?? []).map((s) => ({
    subjectId: s.subject_id,
    subjectName: s.subject_name,
    questionCount: s.question_count,
    attempts: subjectStat.get(s.subject_id)?.attempts ?? 0,
    accuracyPct: subjectStat.get(s.subject_id)?.accuracyPct ?? null,
  }));

  const hasRecentMock = (mocks ?? []).some(
    (m) => m.submitted_at !== null && m.submitted_at >= windowStartTs
  );

  const readiness = memberReadiness(
    {
      passMarkPct: org.pass_mark_pct,
      inactivityDays: org.risk_inactivity_days,
      weekly: weeklyBuckets,
      weeklyActiveDays: (activity ?? []).map((r) => ({
        weekStart: r.week_start,
        days: r.active_days,
      })),
      allTime: {
        attempts: totals?.attempts ?? 0,
        correct: totals?.correct ?? 0,
      },
      subjects,
      hasExamModeTestInWindow: hasRecentMock,
      lastActiveDay: totals?.last_active_day ?? null,
      joinedAt: member.joined_at,
    },
    now
  );

  // Zero-fill the activity strip so every window week renders.
  const daysByWeek = new Map(
    (activity ?? []).map((r) => [r.week_start, r.active_days])
  );
  const weeklyActivity = readiness.weeklyAccuracy.map(({ weekStart }) => ({
    weekStart,
    days: daysByWeek.get(weekStart) ?? 0,
  }));

  // Pacing over exam-mode window attempts that carried a timing.
  const examWeekly = (weekly ?? []).filter((r) => r.mode === "exam");
  const timedAttempts = examWeekly.reduce((s, r) => s + r.timed_attempts, 0);
  const timedSeconds = examWeekly.reduce((s, r) => s + r.time_spent_sec, 0);

  return {
    member,
    name: (profile?.full_name as string | null) ?? null,
    email: (emailRow?.email as string | null) ?? null,
    readiness,
    sitting: sittingFraming(dateRow?.sitting_on ?? null, now),
    attempted: totals?.attempts ?? 0,
    lastActiveDay: totals?.last_active_day ?? null,
    subjects,
    weeklyActivity,
    mockHistory: (mocks ?? []).map((m) => ({
      id: m.id,
      score: m.score === null ? null : Number(m.score),
      submittedAt: m.submitted_at,
      totalQuestions: m.total_questions,
      answeredQuestions: m.answered_questions,
    })),
    pacingSecPerQuestion:
      timedAttempts > 0 ? Math.round(timedSeconds / timedAttempts) : null,
    planAdherencePct: planAdherence?.adherencePct ?? null,
    hasActivePlan: planAdherence?.hasActivePlan ?? false,
  };
}

export type PendingInviteNotice = {
  invite: OrgInvite;
  orgName: string;
};

/**
 * The dashboard banner's lookup: a live invite addressed to this email.
 * Matching is on the citext column, so case differences don't hide it.
 */
export async function pendingInviteForEmail(
  email: string,
  now: Date = new Date()
): Promise<PendingInviteNotice | null> {
  if (email === "") return null;
  const admin = createAdminClient();

  const { data } = await admin
    .from("org_invites")
    .select("*")
    .eq("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  const invite = data as OrgInvite;
  const { data: org } = await admin
    .from("orgs")
    .select("name")
    .eq("id", invite.org_id)
    .maybeSingle();
  if (!org) return null;

  return { invite, orgName: org.name };
}
