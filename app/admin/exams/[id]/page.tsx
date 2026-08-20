import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getExam } from "@/lib/admin/taxonomy";
import { listExamDocumentsForAdmin } from "@/lib/exam-documents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExamDetail } from "@/components/admin/exam-detail";

export async function generateMetadata(
  props: PageProps<"/admin/exams/[id]">
): Promise<Metadata> {
  const { id } = await props.params;
  const exam = await getExam(id);
  return { title: exam?.name ?? "Exam" };
}

export default async function AdminExamPage(
  props: PageProps<"/admin/exams/[id]">
) {
  const { id } = await props.params;
  const exam = await getExam(id);

  if (!exam) notFound();

  // ExamDetail is a Client Component, so the documents are read here — the
  // table is service-role only and requireAdmin() already ran in the layout
  // and is re-run by every action the card posts to.
  const documents = await listExamDocumentsForAdmin(exam.id);

  const questionCount = exam.specialties.reduce(
    (sum, sp) => sum + sp.questionCount,
    0
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/exams">
            <ArrowLeft data-icon="inline-start" />
            Exams
          </Link>
        </Button>
      </div>

      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {exam.name}
          </h1>
          {exam.code && (
            <Badge variant="outline" className="font-mono">
              {exam.code}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-muted-foreground">
          {exam.specialties.length} specialt
          {exam.specialties.length === 1 ? "y" : "ies"} · {questionCount}{" "}
          question{questionCount === 1 ? "" : "s"} filed under this exam.
        </p>
      </header>

      <ExamDetail exam={exam} documents={documents} />
    </div>
  );
}
