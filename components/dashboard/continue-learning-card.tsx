import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import type { ContinueLearningCard as CardData } from "@/lib/courses";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

/** Dashboard "continue learning" card — the caller hides it (null data)
 * when the learner has never started a course (spec §5). */
export function ContinueLearningCard({ data }: { data: CardData }) {
  const resumeHref = data.continueLessonId
    ? `/cme/${data.courseId}/lessons/${data.continueLessonId}`
    : `/cme/${data.courseId}`;

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-3">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <BookOpen className="size-3.5" aria-hidden />
          Continue learning
        </p>
        <p className="font-display text-lg leading-snug">{data.title}</p>
        <div className="space-y-1">
          <Progress
            value={data.completion.pct}
            className="h-1.5"
            aria-label={`${data.completion.pct}% complete`}
          />
          <p className="text-xs text-muted-foreground">
            {data.completion.completedLessons} of {data.completion.totalLessons}{" "}
            lessons · {data.completion.pct}%
          </p>
        </div>
        <Button variant="outline-muted" size="sm" asChild>
          <Link href={resumeHref}>
            Resume
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
