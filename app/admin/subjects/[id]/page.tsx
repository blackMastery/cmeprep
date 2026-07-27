import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSubject, listHierarchy } from "@/lib/admin/taxonomy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SubjectDetail } from "@/components/admin/subject-detail";

export async function generateMetadata(
  props: PageProps<"/admin/subjects/[id]">
): Promise<Metadata> {
  const { id } = await props.params;
  const subject = await getSubject(id);
  return { title: subject?.name ?? "Subject" };
}

export default async function AdminSubjectPage(
  props: PageProps<"/admin/subjects/[id]">
) {
  const { id } = await props.params;
  const [subject, hierarchy] = await Promise.all([
    getSubject(id),
    listHierarchy(),
  ]);

  if (!subject) notFound();

  // Cross-specialty move destinations, labelled so same-named subjects in
  // different specialties stay distinguishable.
  const moveGroups = hierarchy.flatMap((exam) =>
    exam.specialties.flatMap((spec) =>
      spec.subjects.map((s) => ({
        label: `${spec.name} › ${s.name}`,
        topics: s.topics.map((t) => ({ id: t.id, name: t.name })),
      }))
    )
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild>
          {/* Back to the specialty this subject lives in, not the default one. */}
          <Link href={`/admin/subjects?specialty=${subject.specialty_id}`}>
            <ArrowLeft data-icon="inline-start" />
            {subject.specialtyName}
          </Link>
        </Button>
      </div>

      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {subject.name}
          </h1>
          {subject.deletedCount > 0 && (
            <Badge variant="outline">
              +{subject.deletedCount} deleted question
              {subject.deletedCount === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-muted-foreground">
          <Link
            href={`/admin/exams/${subject.examId}`}
            className="underline-offset-4 hover:underline"
          >
            {subject.examName}
          </Link>{" "}
          › {subject.specialtyName} — {subject.topics.length} topic
          {subject.topics.length === 1 ? "" : "s"} · {subject.questionCount}{" "}
          question{subject.questionCount === 1 ? "" : "s"}.
        </p>
      </header>

      <SubjectDetail subject={subject} moveGroups={moveGroups} />
    </div>
  );
}
