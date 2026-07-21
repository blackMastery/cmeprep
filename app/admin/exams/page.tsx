import type { Metadata } from "next";
import { listExamTree } from "@/lib/admin/taxonomy";
import { ExamManager } from "@/components/admin/exam-manager";

export const metadata: Metadata = { title: "Exams & specialties" };

export default async function AdminExamsPage() {
  const exams = await listExamTree();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Exams &amp; specialties
        </h1>
        <p className="mt-1 text-muted-foreground">
          The top of the hierarchy: every specialty belongs to an exam, and
          subjects &amp; topics live inside a specialty.
        </p>
      </header>

      <ExamManager exams={exams} />
    </div>
  );
}
