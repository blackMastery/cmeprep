"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import type { ExamCard } from "@/lib/admin/taxonomy";
import { createExam } from "@/app/admin/exams/actions";
import type { AdminState } from "@/app/admin/subjects/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FormMessage } from "@/components/auth/form-parts";
import { AdminSubmit } from "@/components/admin/form-parts";
import { ExamReorderButtons } from "@/components/admin/exam-detail";

/**
 * The index is a summary board: each card says what an exam holds and links
 * to its detail page. Renaming, deleting and specialty editing all live in
 * /admin/exams/[id] — a grid of inline forms stopped being readable once the
 * cards had to carry counts as well.
 */
export function ExamManager({ exams }: { exams: ExamCard[] }) {
  const [createState, createAction] = useActionState<AdminState, FormData>(
    createExam,
    null
  );

  return (
    <div className="space-y-6">
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="space-y-4">
          <h2 className="font-display text-lg">Add an exam</h2>
          <FormMessage error={createState?.error} success={createState?.success} />
          <form action={createAction} className="flex flex-wrap gap-2">
            <Input
              name="name"
              placeholder="e.g. USMLE Step 1"
              required
              className="h-10 max-w-xs flex-1"
            />
            <Input
              name="code"
              placeholder="Code (optional)"
              className="h-10 w-36"
            />
            <AdminSubmit>
              <Plus data-icon="inline-start" />
              Add exam
            </AdminSubmit>
          </form>
        </CardContent>
      </Card>

      {exams.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No exams yet. Add one above — specialties, subjects and topics all
            live under an exam.
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {exams.map((exam, index) => (
            <li key={exam.id} className="flex">
              <ExamSummaryCard
                exam={exam}
                isFirst={index === 0}
                isLast={index === exams.length - 1}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExamSummaryCard({
  exam,
  isFirst,
  isLast,
}: {
  exam: ExamCard;
  isFirst: boolean;
  isLast: boolean;
}) {
  const href = `/admin/exams/${exam.id}`;

  return (
    <Card className="relative flex-1 transition-shadow [--card-spacing:--spacing(5)] hover:ring-2 hover:ring-primary/30 focus-within:ring-2 focus-within:ring-primary/30">
      <CardHeader>
        <CardTitle className="font-display text-lg">
          {/* Stretched link: the whole card is the target, but the reorder
              buttons sit above it so they stay clickable. */}
          <Link href={href} className="after:absolute after:inset-0">
            {exam.name}
          </Link>
        </CardTitle>
        <CardDescription>
          {exam.code ? (
            <Badge variant="outline" className="font-mono">
              {exam.code}
            </Badge>
          ) : (
            <span className="text-xs">No code set</span>
          )}
        </CardDescription>
        <CardAction className="relative z-10">
          <ExamReorderButtons
            table="exams"
            id={exam.id}
            isFirst={isFirst}
            isLast={isLast}
          />
        </CardAction>
      </CardHeader>

      <CardContent>
        <dl className="grid grid-cols-4 gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-center">
          <Stat label="Specialties" value={exam.specialtyCount} />
          <Stat label="Subjects" value={exam.subjectCount} />
          <Stat label="Topics" value={exam.topicCount} />
          <Stat label="Questions" value={exam.questionCount} />
        </dl>
      </CardContent>

      <CardFooter className="justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {exam.specialtyCount === 0
            ? "Add a specialty to start filing content."
            : exam.questionCount === 0
              ? "No questions filed under this exam yet."
              : "Ready for tests."}
        </p>
        <Button variant="outline-muted" size="sm" className="relative z-10" asChild>
          <Link href={href}>
            Manage
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[0.7rem] text-muted-foreground">{label}</dt>
      <dd className="font-display text-lg tabular-nums">{value}</dd>
    </div>
  );
}
