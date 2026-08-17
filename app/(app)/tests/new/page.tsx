import type { Metadata } from "next";
import { requireUser, hasTrialsRemaining } from "@/lib/auth";
import { listActivePlans, paidPlans } from "@/lib/plans";
import { listExamCatalogTree } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/server";
import { getExamAccess } from "@/lib/entitlements";
import {
  canAccessExam,
  consumesTrialCredit,
  visibleExamsFor,
} from "@/lib/entitlements-core";
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

  const supabase = await createClient();
  const [tree, access, plans, { data: osceCounts }] = await Promise.all([
    listExamCatalogTree(),
    getExamAccess(user),
    listActivePlans(),
    // Published OSCE stations per subject — the wizard only offers OSCE mode
    // where stations actually exist. RLS-safe view, so the user client is fine.
    supabase
      .from("subject_osce_question_counts")
      .select("subject_id, question_count"),
  ]);
  const osceCountBySubject = new Map(
    (osceCounts ?? []).map((r) => [r.subject_id, r.question_count])
  );

  // The full-page trial wall only makes sense when EVERYTHING would be
  // metered: a member whose org covers any exam (or just the bank) still has
  // unmetered ground to practise on, so they get the wizard with per-exam
  // locks instead (SPEC §3).
  const quotaExhausted =
    user.profile.role === "trial" && !hasTrialsRemaining(user.profile);
  if (!access.org && quotaExhausted) {
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
  // can no longer buy. An exhausted-quota member sees metered exams locked
  // rather than dead-ending at the API.
  const exams = visibleExamsFor(tree, access).map((exam) => {
    const specialties = exam.specialties.map((specialty) => ({
      id: specialty.id,
      name: specialty.name,
      subjects: specialty.subjects.map((subject) => ({
        id: subject.id,
        name: subject.name,
        osceQuestionCount: osceCountBySubject.get(subject.id) ?? 0,
      })),
    }));
    return {
      id: exam.id,
      name: exam.name,
      subjectCount: exam.subjectCount,
      questionCount: exam.questionCount,
      locked:
        !canAccessExam(access, { id: exam.id, orgId: exam.orgId }) ||
        (quotaExhausted &&
          consumesTrialCredit(user.profile.role, access, {
            id: exam.id,
            orgId: exam.orgId,
          })),
      // OSCE is paid-only (every grade is an AI call): honest presentation of
      // the /api/tests gate, which enforces with the same predicate.
      osceLocked: consumesTrialCredit(user.profile.role, access, {
        id: exam.id,
        orgId: exam.orgId,
      }),
      osceQuestionCount: specialties
        .flatMap((sp) => sp.subjects)
        .reduce((sum, s) => sum + s.osceQuestionCount, 0),
      specialties,
    };
  });

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
