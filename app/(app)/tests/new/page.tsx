import type { Metadata } from "next";
import { requireUser, hasTrialsRemaining } from "@/lib/auth";
import { listActivePlans, paidPlans } from "@/lib/plans";
import { listExamCatalogTree } from "@/lib/catalog";
import { getExamAccess } from "@/lib/entitlements";
import { canAccessExam, visibleExamsFor } from "@/lib/entitlements-core";
import type { Plan } from "@/lib/supabase/types";
import { NewTestWizard } from "@/components/test/new-test-wizard";
import { TrialLimitCard } from "@/components/app/trial-limit-card";
import { ExamAccessRequiredCard } from "@/components/app/exam-access-required-card";

export const metadata: Metadata = { title: "New test" };

/**
 * Where a locked exam's "Get access" link points: the featured paid plan,
 * else the cheapest. Checkout then offers a "Change plan" link back to
 * /#pricing, so the loop closes without a separate plan-picker route.
 */
function upsellPlan(plans: Plan[]): Plan | null {
  const buyable = paidPlans(plans).filter((p) => p.duration_months !== null);
  return (
    [...buyable].sort(
      (a, b) =>
        Number(b.featured) - Number(a.featured) || a.price_cents - b.price_cents
    )[0] ?? null
  );
}

export default async function NewTestPage() {
  const user = await requireUser();

  const [tree, access, plans] = await Promise.all([
    listExamCatalogTree(),
    getExamAccess(user),
    listActivePlans(),
  ]);

  // The quota gates trial-ROLE users only; an org-covered member is
  // unmetered regardless of role (SPEC §3), so access must be computed
  // before the trial wall can be shown.
  const orgCovered = access.kind === "all" && access.reason === "org";
  if (!orgCovered && !hasTrialsRemaining(user.profile)) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12">
        <TrialLimitCard profile={user.profile} plans={paidPlans(plans)} />
      </div>
    );
  }

  const upsellPlanId = upsellPlan(plans)?.id ?? null;

  // Locked exams are still shipped: they're the upsell. /api/tests is what
  // actually enforces — this is presentation. Retired exams are dropped
  // unless this user's access names one, so nobody is offered an exam they
  // can no longer buy.
  const exams = visibleExamsFor(tree, access).map((exam) => ({
    id: exam.id,
    name: exam.name,
    subjectCount: exam.subjectCount,
    questionCount: exam.questionCount,
    locked: !canAccessExam(access, { id: exam.id, orgId: exam.orgId }),
    specialties: exam.specialties.map((specialty) => ({
      id: specialty.id,
      name: specialty.name,
      subjects: specialty.subjects.map((subject) => ({
        id: subject.id,
        name: subject.name,
      })),
    })),
  }));

  if (exams.length > 0 && exams.every((exam) => exam.locked)) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12">
        <ExamAccessRequiredCard exams={exams} upsellPlanId={upsellPlanId} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <NewTestWizard exams={exams} upsellPlanId={upsellPlanId} />
    </div>
  );
}
