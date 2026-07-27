import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EcgDivider } from "@/components/brand/ecg-line";
import { LockedExamRow } from "@/components/test/locked-exam-row";

type LockedExam = {
  id: string;
  name: string;
  subjectCount: number;
  questionCount: number;
};

/**
 * Sibling of TrialLimitCard, for a student whose subscription covers no exam
 * in the catalogue — a lapsed period whose role sync hasn't run, or a scoped
 * exam that was later removed.
 */
export function ExamAccessRequiredCard({
  exams,
  upsellPlanId,
}: {
  exams: LockedExam[];
  upsellPlanId: string | null;
}) {
  return (
    <Card className="[--card-spacing:--spacing(7)]">
      <CardContent className="space-y-5">
        <div className="space-y-5 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-accent text-primary">
            <Lock className="size-6" aria-hidden="true" />
          </span>

          <div className="space-y-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              Choose an examination to unlock
            </h1>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">
              A subscription covers one examination. Pick the one you&apos;re
              sitting and you&apos;ll be practising in a couple of minutes.
            </p>
          </div>
        </div>

        {exams.length > 0 && (
          <>
            <EcgDivider className="text-primary/30" />
            <div className="grid gap-2.5">
              {exams.map((exam) => (
                <LockedExamRow
                  key={exam.id}
                  name={exam.name}
                  subjectCount={exam.subjectCount}
                  questionCount={exam.questionCount}
                  href={
                    upsellPlanId
                      ? `/checkout/${upsellPlanId}?exam=${exam.id}`
                      : null
                  }
                />
              ))}
            </div>
          </>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button size="lg" asChild>
            <Link href="/#pricing">View plans</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
