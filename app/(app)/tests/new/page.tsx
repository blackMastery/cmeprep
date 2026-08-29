import type { Metadata } from "next";
import { requireUser, hasTrialsRemaining } from "@/lib/auth";
import { listActivePlans, paidPlans, upsellPlan } from "@/lib/plans";
import { listExamCatalogTree } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/server";
import { getExamAccess } from "@/lib/entitlements";
import { listEnabledLanguageCodes } from "@/lib/translations";
import {
  canAccessExam,
  consumesTrialCredit,
  TRIAL_MAX_QUESTIONS,
  visibleExamsFor,
} from "@/lib/entitlements-core";
import { NewTestWizard } from "@/components/test/new-test-wizard";
import { TrialLimitCard } from "@/components/app/trial-limit-card";
import { ExamAccessRequiredCard } from "@/components/app/exam-access-required-card";

export const metadata: Metadata = { title: "New test" };

export default async function NewTestPage() {
  const user = await requireUser();

  const supabase = await createClient();
  const [tree, access, plans, { data: osceCounts }, enabledLanguageCodes] =
    await Promise.all([
      listExamCatalogTree(),
      getExamAccess(user),
      listActivePlans(),
      // Published OSCE stations per subject — the wizard only offers OSCE mode
      // where stations actually exist. RLS-safe view, so the user client is fine.
      supabase
        .from("subject_osce_question_counts")
        .select("subject_id, question_count"),
      listEnabledLanguageCodes(),
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
        questionCount: subject.questionCount,
        osceQuestionCount: osceCountBySubject.get(subject.id) ?? 0,
      })),
    }));
    const metered = consumesTrialCredit(user.profile.role, access, {
      id: exam.id,
      orgId: exam.orgId,
    });
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
      osceLocked: metered,
      // Same predicate again: a metered session is trial-sized. /api/tests
      // clamps regardless; this keeps the count chips honest.
      questionCap: metered ? TRIAL_MAX_QUESTIONS : null,
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
    // The wizard owns the viewport below the app header: its header and
    // footer stay put and only the step content scrolls. Phones pin the
    // footer to the bottom of the screen (thumb reach); from `sm` the card
    // grows with its content and only caps at the viewport. On short
    // (landscape-phone) viewports `tall:` doesn't match and the page scrolls
    // normally instead of squeezing the content into a sliver.
    <div className="mx-auto flex w-full max-w-3xl flex-col tall:h-[calc(100dvh-var(--app-header-h))] sm:p-4 sm:py-6 sm:tall:h-auto sm:tall:max-h-[calc(100dvh-var(--app-header-h))]">
      <NewTestWizard
        exams={exams}
        upsellPlanId={upsellPlanId}
        enabledLanguageCodes={enabledLanguageCodes}
        defaultLanguage={user.profile.preferred_language}
      />
    </div>
  );
}
