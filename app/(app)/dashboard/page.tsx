import type { Metadata } from "next";
import Link from "next/link";
import { Flame, Plus, Target, TrendingUp } from "lucide-react";
import { requireUser, hasTrialsRemaining } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLifetimeStats, getOwnReadiness } from "@/lib/stats";
import { firstName } from "@/lib/names";
import {
  canAccessExam,
  examAccessFor,
  type SubscriptionScope,
} from "@/lib/entitlements-core";
import { orgGrantContextFrom } from "@/lib/entitlements";
import {
  assignmentsForMember,
  getOrgDepartment,
  getOrgMembership,
  pendingInviteForEmail,
} from "@/lib/orgs";
import { OrgInviteBanner } from "@/components/org/org-invite-banner";
import { OrgUpsellCard } from "@/components/org/org-upsell-card";
import { MemberAccessBanner } from "@/components/org/org-access-banners";
import { AssignmentsCard } from "@/components/dashboard/assignments-card";
import { ContinueLearningCard } from "@/components/dashboard/continue-learning-card";
import { ReadinessCard } from "@/components/dashboard/readiness-card";
import { continueLearning } from "@/lib/courses";
import { daysUntil } from "@/lib/subscriptions-core";
import { orgGraceEnd, orgSubscriptionState } from "@/lib/orgs-core";
import { listExamCatalog } from "@/lib/catalog";
import type { Test, SubjectAccuracy } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { WeakAreas } from "@/components/dashboard/weak-areas";
import { PastTests } from "@/components/dashboard/past-tests";
import { AccountPanel } from "@/components/dashboard/account-panel";
import { ExpiryBanners } from "@/components/subscriptions/expiry-banners";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = await createClient();

  // One shared lifetime-stats read (also used by /profile) plus three page
  // queries; RLS scopes everything to this user automatically.
  const [
    { stats: userStats, examStats, tutorStats, streak },
    { data: subjects },
    { data: tests },
    { data: subs },
    orgCtx,
    inviteNotice,
    courseCard,
  ] = await Promise.all([
    getLifetimeStats(user.id),
    supabase
      .from("subject_accuracy")
      .select("*")
      .eq("user_id", user.id)
      .gte("attempts", 5)
      .order("accuracy_pct", { ascending: true })
      .limit(5),
    supabase
      .from("tests")
      .select("*")
      .eq("user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(8),
    supabase
      .from("subscriptions")
      .select("status, current_period_end, exam_id")
      .eq("user_id", user.id),
    orgGrantContextFrom(supabase, user.id),
    pendingInviteForEmail(user.email),
    continueLearning(user.id),
  ]);

  const subscriptions = (subs ?? []) as SubscriptionScope[];
  const greetingName = firstName(user.profile.full_name);

  // Sequential on purpose: these reads depend on membership existing at all,
  // and non-members (the common case) skip them entirely.
  const membership = orgCtx ? await getOrgMembership(user.id) : null;
  const [memberAssignments, memberDepartment, ownReadiness] = membership
    ? await Promise.all([
        assignmentsForMember(membership.org.id, user.id, membership.membership),
        membership.membership.department_id
          ? getOrgDepartment(
              membership.org.id,
              membership.membership.department_id
            )
          : null,
        getOwnReadiness(user.id),
      ])
    : [null, null, null];
  // "Cardiology · Springfield General" — the read-only department label.
  const orgLabel = membership
    ? memberDepartment
      ? `${memberDepartment.name} · ${membership.org.name}`
      : membership.org.name
    : null;

  // null = all exams (trial, admin, an all-access row, or an org comp) — the
  // panel says so rather than listing the whole catalogue. Otherwise list
  // the UNION the member can practise: personal rows + org-bought exams +
  // the org's own bank — canAccessExam already states that rule, including
  // for kind "none" (a paying org member with no personal rows).
  const access = examAccessFor(
    user.profile.role,
    subscriptions,
    orgCtx,
    new Date()
  );
  // A member whose org covers anything has unmetered ground to start on
  // (SPEC §3): the start button must not vanish with their trial quota.
  const orgCovered = access.org !== null;
  const entitledExamNames =
    access.kind === "all" || access.org?.allAccess
      ? null
      : (await listExamCatalog())
          .filter((exam) =>
            canAccessExam(access, { id: exam.id, orgId: exam.orgId })
          )
          .map((exam) => exam.name);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {greetingName ? `Welcome back, ${greetingName}` : "Welcome back"}
          </h1>
          <p className="mt-1 text-muted-foreground">
            Pick up where you left off, or start something new.
          </p>
        </div>
        {(orgCovered || hasTrialsRemaining(user.profile)) && (
          <Button size="lg" asChild>
            <Link href="/tests/new">
              <Plus data-icon="inline-start" />
              Start new test
            </Link>
          </Button>
        )}
      </header>

      {/* Members can't accept a second org's invite, so don't dangle it. */}
      {!orgCtx && inviteNotice && (
        <OrgInviteBanner
          inviteId={inviteNotice.invite.id}
          orgName={inviteNotice.orgName}
        />
      )}

      {membership &&
        orgCtx &&
        orgCtx.suspended_at === null &&
        (() => {
          const state = orgSubscriptionState(orgCtx.subs, new Date());
          const latestActiveEnd = orgCtx.subs
            .filter((s) => s.status === "active")
            .map((s) => s.current_period_end)
            .sort()
            .at(-1);
          const graceEnd =
            state === "grace" && latestActiveEnd
              ? orgGraceEnd(latestActiveEnd).toISOString()
              : null;
          return (
            <MemberAccessBanner
              state={state}
              orgName={membership.org.name}
              graceEndsAt={graceEnd}
              daysLeft={graceEnd ? daysUntil(graceEnd, new Date()) : 0}
            />
          );
        })()}

      <ExpiryBanners subscriptions={subscriptions} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={Target}
          label="Questions attempted"
          value={userStats?.attempted ?? 0}
        />
        <StatCard
          icon={TrendingUp}
          label="Accuracy"
          tone="teal"
          value={
            userStats?.attempted ? `${Math.round(userStats.accuracy_pct)}%` : "—"
          }
          hint={
            // Instant-feedback tutor accuracy isn't comparable to timed exam
            // accuracy, so once both modes have data the split replaces the
            // plain count. The headline number stays combined.
            examStats && tutorStats
              ? `Exam ${Math.round(examStats.accuracy_pct)}% · Tutor ${Math.round(tutorStats.accuracy_pct)}%`
              : userStats?.attempted
                ? `${userStats.correct} of ${userStats.attempted} correct`
                : "Take a test to see this"
          }
        />
        <StatCard
          icon={Flame}
          label="Day streak"
          tone="teal"
          value={streak}
          hint={streak > 0 ? "Keep it going" : "Answer a question today"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <PastTests tests={(tests ?? []) as Test[]} />
        </div>
        <div className="space-y-6">
          {courseCard && <ContinueLearningCard data={courseCard} />}
          {ownReadiness && <ReadinessCard own={ownReadiness} />}
          {membership && memberAssignments && (
            <AssignmentsCard
              assignments={memberAssignments}
              orgName={orgLabel ?? membership.org.name}
            />
          )}
          <WeakAreas subjects={(subjects ?? []) as SubjectAccuracy[]} />
          <AccountPanel
            profile={user.profile}
            examNames={entitledExamNames}
            orgCovered={orgCovered}
          />
          {/* Org-less users only — and not while an invite banner is already
              offering them an org to join. */}
          {!orgCtx && !inviteNotice && <OrgUpsellCard />}
        </div>
      </div>
    </div>
  );
}
