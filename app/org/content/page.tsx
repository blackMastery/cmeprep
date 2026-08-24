import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks, Plus } from "lucide-react";
import { requireOrgAdmin } from "@/lib/orgs";
import { listHierarchy } from "@/lib/admin/taxonomy";
import { createAdminClient } from "@/lib/supabase/admin";
import { openReportQuestionCount } from "@/lib/admin/question-reports";
import { ReportsLink } from "@/components/admin/question-reports-page";
import { Button } from "@/components/ui/button";
import { OrgExamCards, type OrgExamCard } from "@/components/org/exam-cards";

export const metadata: Metadata = { title: "Content" };

export default async function OrgContentPage() {
  const session = await requireOrgAdmin();
  const [hierarchy, openReports] = await Promise.all([
    listHierarchy(session.org.id),
    openReportQuestionCount({ kind: "org", orgId: session.org.id }),
  ]);

  // Hierarchy counts include drafts; members only ever see published — the
  // cards show both so "why can't my team see this?" answers itself.
  const subjectIds = hierarchy.flatMap((exam) =>
    exam.specialties.flatMap((sp) => sp.subjects.map((s) => s.id))
  );
  const publishedBySubject = new Map<string, number>();
  if (subjectIds.length > 0) {
    const admin = createAdminClient();
    // Both views, summed: subject_question_counts deliberately excludes OSCE
    // (the wizard's exam/tutor modes cannot deal stations), but a bank's
    // "published" total must count everything it holds — otherwise a bank of
    // 50 published stations reads "50 questions · 0 published", which is
    // exactly the confusion these two numbers exist to prevent.
    const [{ data: mcq }, { data: osce }] = await Promise.all([
      admin
        .from("subject_question_counts")
        .select("subject_id, question_count")
        .in("subject_id", subjectIds),
      admin
        .from("subject_osce_question_counts")
        .select("subject_id, question_count")
        .in("subject_id", subjectIds),
    ]);
    for (const row of [...(mcq ?? []), ...(osce ?? [])]) {
      publishedBySubject.set(
        row.subject_id,
        (publishedBySubject.get(row.subject_id) ?? 0) + row.question_count
      );
    }
  }

  const cards: OrgExamCard[] = hierarchy.map((exam) => {
    const subjects = exam.specialties.flatMap((sp) => sp.subjects);
    return {
      id: exam.id,
      name: exam.name,
      specialtyCount: exam.specialties.length,
      subjectCount: subjects.length,
      questionCount: subjects.reduce((sum, s) => sum + s.questionCount, 0),
      publishedCount: subjects.reduce(
        (sum, s) => sum + (publishedBySubject.get(s.id) ?? 0),
        0
      ),
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-2">
        <ReportsLink href="/org/content/reports" count={openReports} />
        <Button variant="outline" asChild>
          <Link href="/org/content/questions">
            <ListChecks data-icon="inline-start" />
            All questions
          </Link>
        </Button>
        <Button asChild>
          <Link href="/org/content/questions/new">
            <Plus data-icon="inline-start" />
            New question
          </Link>
        </Button>
      </div>

      <OrgExamCards exams={cards} />
    </div>
  );
}
