import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getExam } from "@/lib/admin/taxonomy";
import { Button } from "@/components/ui/button";
import { ImportWizard } from "@/components/admin/import-wizard";

export async function generateMetadata(
  props: PageProps<"/admin/exams/[id]/import">
): Promise<Metadata> {
  const { id } = await props.params;
  const exam = await getExam(id);
  return { title: exam ? `Import · ${exam.name}` : "Import questions" };
}

export default async function ExamImportPage(
  props: PageProps<"/admin/exams/[id]/import">
) {
  const { id } = await props.params;
  const exam = await getExam(id);
  if (!exam) notFound();

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/admin/exams/${exam.id}`}>
            <ArrowLeft data-icon="inline-start" />
            {exam.name}
          </Link>
        </Button>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Import questions
        </h1>
      </div>

      <ImportWizard examId={exam.id} examName={exam.name} />
    </div>
  );
}
