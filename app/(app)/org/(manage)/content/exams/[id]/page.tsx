import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOrgAdmin } from "@/lib/orgs";
import { listHierarchy } from "@/lib/admin/taxonomy";
import {
  OrgExamDetail,
  type OrgExamDetailData,
} from "@/components/org/exam-detail";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Manage exam" };

export default async function OrgExamPage(
  props: PageProps<"/org/content/exams/[id]">
) {
  const session = await requireOrgAdmin();
  const { id } = await props.params;

  // Org-scoped hierarchy: another org's exam simply isn't in it, so foreign
  // ids 404 without ever confirming they exist.
  const hierarchy = await listHierarchy(session.org.id);
  const found = hierarchy.find((exam) => exam.id === id);
  if (!found) notFound();

  const exam: OrgExamDetailData = {
    id: found.id,
    name: found.name,
    specialties: found.specialties.map((sp) => ({
      id: sp.id,
      name: sp.name,
      subjects: sp.subjects.map((s) => ({
        id: s.id,
        name: s.name,
        questionCount: s.questionCount,
        deletedCount: s.deletedCount,
      })),
    })),
  };

  const questionCount = exam.specialties.reduce(
    (sum, sp) => sum + sp.subjects.reduce((n, s) => n + s.questionCount, 0),
    0
  );

  return (
    <div>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/org/content">
            <ArrowLeft data-icon="inline-start" />
            Content
          </Link>
        </Button>
      </div>

      <header className="mb-8">
        <h2 className="font-display text-3xl font-semibold tracking-tight">
          {exam.name}
        </h2>
        <p className="mt-1 text-muted-foreground">
          {exam.specialties.length} specialt
          {exam.specialties.length === 1 ? "y" : "ies"} · {questionCount}{" "}
          question{questionCount === 1 ? "" : "s"} filed under this exam.
        </p>
      </header>

      <OrgExamDetail exam={exam} />
    </div>
  );
}
