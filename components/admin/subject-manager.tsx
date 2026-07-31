"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import type { SubjectWithCount } from "@/lib/admin/taxonomy";
import { createSubject, type AdminState } from "@/app/admin/subjects/actions";
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
import { FormMessage } from "@/components/auth/form-parts";
import { AdminSubmit } from "@/components/admin/form-parts";
import { SubjectReorderButtons } from "@/components/admin/subject-detail";

/**
 * Mirror of ExamManager: the index summarises, /admin/subjects/[id] edits.
 */
export function SubjectManager({
  subjects,
  specialtyId,
}: {
  subjects: SubjectWithCount[];
  specialtyId: string;
}) {
  const [createState, createAction] = useActionState<AdminState, FormData>(
    createSubject,
    null
  );

  return (
    <div className="space-y-6">
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="space-y-4">
          <h2 className="font-display text-lg">Add a subject</h2>
          <FormMessage error={createState?.error} success={createState?.success} />
          <form action={createAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="specialtyId" value={specialtyId} />
            <Input
              name="name"
              placeholder="e.g. Ophthalmology"
              required
              className="h-10 max-w-xs flex-1"
            />
            <AdminSubmit>
              <Plus data-icon="inline-start" />
              Add subject
            </AdminSubmit>
          </form>
        </CardContent>
      </Card>

      {subjects.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No subjects yet. Add one above to get started.
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {subjects.map((subject, index) => (
            <li key={subject.id} className="flex">
              <SubjectSummaryCard
                subject={subject}
                isFirst={index === 0}
                isLast={index === subjects.length - 1}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SubjectSummaryCard({
  subject,
  isFirst,
  isLast,
}: {
  subject: SubjectWithCount;
  isFirst: boolean;
  isLast: boolean;
}) {
  const href = `/admin/subjects/${subject.id}`;

  return (
    <Card className="relative flex-1 transition-shadow [--card-spacing:--spacing(5)] hover:ring-2 hover:ring-primary/30 focus-within:ring-2 focus-within:ring-primary/30">
      <CardHeader>
        <CardTitle className="font-display text-lg">
          {/* Stretched link: the whole card is the target, but the reorder
              buttons sit above it so they stay clickable. */}
          <Link href={href} className="after:absolute after:inset-0">
            {subject.name}
          </Link>
        </CardTitle>
        <CardDescription className="text-xs">
          {subject.questionCount === 0
            ? "No questions yet"
            : `${subject.questionCount} question${subject.questionCount === 1 ? "" : "s"}`}
        </CardDescription>
        <CardAction className="relative z-10">
          <SubjectReorderButtons id={subject.id} isFirst={isFirst} isLast={isLast} />
        </CardAction>
      </CardHeader>

      <CardContent>
        <dl className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-center">
          <Stat label="Questions" value={subject.questionCount} />
          <Stat label="Deleted" value={subject.deletedCount} muted />
        </dl>
      </CardContent>

      <CardFooter className="justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {subject.questionCount === 0
            ? "Add a question to file it here."
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

function Stat({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div>
      <dt className="text-[0.7rem] text-muted-foreground">{label}</dt>
      <dd
        className={
          muted && value === 0
            ? "font-display text-lg text-muted-foreground tabular-nums"
            : "font-display text-lg tabular-nums"
        }
      >
        {value}
      </dd>
    </div>
  );
}
