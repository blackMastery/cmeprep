import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getCourseTree } from "@/lib/courses";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Markdown } from "@/components/markdown";
import { Syllabus } from "@/components/course/syllabus";

export const metadata: Metadata = { title: "CME course" };

export default async function CourseOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const tree = await getCourseTree(id, user.id);
  if (!tree) notFound();

  const { course, completion, continueLessonId } = tree;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2">
        <Link href="/cme">
          <ArrowLeft data-icon="inline-start" />
          All CME courses
        </Link>
      </Button>

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {course.title}
          </h1>
          {course.status === "draft" && (
            <Badge variant="secondary">Draft preview</Badge>
          )}
        </div>
        {course.description && (
          <Markdown className="mt-2 text-muted-foreground">
            {course.description}
          </Markdown>
        )}
      </header>

      <Card className="mb-6 [--card-spacing:--spacing(5)]">
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          {completion.done ? (
            <p className="flex items-center gap-2 font-medium text-primary">
              <CheckCircle2 className="size-5" aria-hidden />
              Course completed — nice work.
            </p>
          ) : (
            <div className="min-w-48 flex-1 space-y-1">
              <Progress
                value={completion.pct}
                className="h-2"
                aria-label={`${completion.pct}% complete`}
              />
              <p className="text-xs text-muted-foreground">
                {completion.completedLessons} of {completion.totalLessons}{" "}
                lessons complete · {completion.pct}%
              </p>
            </div>
          )}
          {continueLessonId && (
            <Button asChild>
              <Link href={`/cme/${course.id}/lessons/${continueLessonId}`}>
                {completion.completedLessons === 0 ? "Start course" : "Continue"}
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <Syllabus tree={tree} />
    </div>
  );
}
