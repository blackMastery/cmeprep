import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { getCourseBuilder, signedCourseFileUrl } from "@/lib/admin/courses";
import { Button } from "@/components/ui/button";
import { CourseBuilder } from "@/components/admin/course-builder";

export const metadata: Metadata = { title: "CME course builder" };

export default async function AdminCourseBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const builder = await getCourseBuilder(id);
  if (!builder) notFound();

  const coverUrl = builder.course.cover_path
    ? await signedCourseFileUrl(builder.course.cover_path)
    : null;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2">
          <Link href="/admin/courses">
            <ArrowLeft data-icon="inline-start" />
            All CME courses
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {builder.course.title}
          </h1>
          {/* Admins preview through the real learner pages — the courses RLS
              lets an admin session read drafts. */}
          <Button variant="outline-muted" size="sm" asChild>
            <Link href={`/cme/${builder.course.id}`}>
              <Eye data-icon="inline-start" />
              Preview as learner
            </Link>
          </Button>
        </div>
      </header>

      <CourseBuilder builder={builder} coverUrl={coverUrl} />
    </div>
  );
}
