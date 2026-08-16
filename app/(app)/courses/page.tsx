import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, CheckCircle2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listCourseCards } from "@/lib/courses";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export const metadata: Metadata = { title: "Courses" };

export default async function CoursesPage() {
  const user = await requireUser();
  const cards = await listCourseCards(user.id);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Courses
        </h1>
        <p className="mt-1 text-muted-foreground">
          Structured lessons with quizzes that unlock as you go — free with
          your account.
        </p>
      </header>

      {cards.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <BookOpen className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              No courses have been published yet — check back soon.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ course, coverUrl, completion, started }) => (
            <li key={course.id} className="flex">
              <Card className="relative flex-1 overflow-hidden pt-0 transition-shadow [--card-spacing:--spacing(5)] hover:ring-2 hover:ring-primary/30 focus-within:ring-2 focus-within:ring-primary/30">
                <div className="flex h-32 items-center justify-center bg-secondary/60">
                  {coverUrl ? (
                    // Signed URLs change per render; next/image caching would
                    // thrash on them.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={coverUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <BookOpen
                      className="size-8 text-muted-foreground/60"
                      aria-hidden
                    />
                  )}
                </div>
                <CardContent className="space-y-3">
                  <h2 className="font-display text-lg leading-snug">
                    <Link
                      href={`/courses/${course.id}`}
                      className="after:absolute after:inset-0"
                    >
                      {course.title}
                    </Link>
                  </h2>
                  {course.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {course.description}
                    </p>
                  )}
                  {completion.done ? (
                    <Badge>
                      <CheckCircle2 data-icon="inline-start" />
                      Completed
                    </Badge>
                  ) : started ? (
                    <div className="space-y-1">
                      <Progress
                        value={completion.pct}
                        className="h-1.5"
                        aria-label={`${completion.pct}% complete`}
                      />
                      <p className="text-xs text-muted-foreground">
                        {completion.completedLessons} of{" "}
                        {completion.totalLessons} lessons · {completion.pct}%
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {completion.totalLessons} lesson
                      {completion.totalLessons === 1 ? "" : "s"} · not started
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
