import Link from "next/link";
import { CheckCircle2, Circle, Lock } from "lucide-react";
import type { CourseTree } from "@/lib/courses";
import { cn } from "@/lib/utils";

/**
 * The module/lesson outline, shared by the course overview (full width) and
 * the lesson player (sidebar). Locked modules list their lesson TITLES —
 * that's deliberate scope (spec §7): titles are the teaser, content and
 * files are what the server withholds.
 */
export function Syllabus({
  tree,
  currentLessonId,
  compact = false,
}: {
  tree: CourseTree;
  currentLessonId?: string;
  compact?: boolean;
}) {
  return (
    <nav aria-label="Course outline" className="space-y-4">
      {tree.modules.map(({ module, lessons }, index) => {
        const locked = !tree.unlocked.has(module.id);
        return (
          <section key={module.id}>
            <h3
              className={cn(
                "mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase",
                locked ? "text-muted-foreground" : "text-foreground/80"
              )}
            >
              {locked && <Lock className="size-3" aria-hidden />}
              <span className="truncate">
                {index + 1}. {module.title}
              </span>
            </h3>
            {locked && !compact && (
              <p className="mb-1.5 text-xs text-muted-foreground">
                Pass the earlier module quiz to unlock.
              </p>
            )}
            <ul className="space-y-0.5">
              {lessons.map((lesson) => {
                const completed = tree.completed.has(lesson.id);
                const current = lesson.id === currentLessonId;
                const row = (
                  <span
                    className={cn(
                      "flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-sm",
                      current && "bg-secondary font-medium",
                      locked && "text-muted-foreground"
                    )}
                  >
                    {completed ? (
                      <CheckCircle2
                        className="size-4 shrink-0 text-primary"
                        aria-hidden
                      />
                    ) : (
                      <Circle
                        className="size-4 shrink-0 text-muted-foreground/50"
                        aria-hidden
                      />
                    )}
                    <span className="min-w-0 truncate">
                      {lesson.title}
                      {lesson.kind === "quiz" && (
                        <span className="text-muted-foreground"> · quiz</span>
                      )}
                    </span>
                  </span>
                );

                return (
                  <li key={lesson.id}>
                    {locked ? (
                      row
                    ) : (
                      <Link
                        href={`/cme/${tree.course.id}/lessons/${lesson.id}`}
                        aria-current={current ? "page" : undefined}
                        className="block rounded-md hover:bg-secondary/60"
                      >
                        {row}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
