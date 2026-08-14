"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { createOrgExam } from "@/app/(app)/org/(manage)/content/actions";
import type { OrgActionState } from "@/app/(app)/org/(manage)/members/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
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

export type OrgExamCard = {
  id: string;
  name: string;
  specialtyCount: number;
  subjectCount: number;
  questionCount: number;
  publishedCount: number;
};

/**
 * Summary board for the org's private bank, mirroring /admin/exams: each
 * card says what an exam holds and links to its detail page — renaming,
 * specialties and deletion all live there.
 */
export function OrgExamCards({ exams }: { exams: OrgExamCard[] }) {
  const [createState, createAction] = useActionState<OrgActionState, FormData>(
    createOrgExam,
    null
  );

  return (
    <div className="space-y-6">
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="space-y-4">
          <div>
            <h2 className="font-display text-lg">Add an exam</h2>
            <p className="text-xs text-muted-foreground">
              Private to your organisation — members see it in the practice
              wizard alongside the public catalogue.
            </p>
          </div>
          <FormMessage error={createState?.error} success={createState?.success} />
          <form action={createAction} className="flex flex-wrap gap-2">
            <Input
              name="name"
              placeholder="e.g. Internal Protocols 2026"
              required
              className="h-10 max-w-xs flex-1"
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
            No private exams yet. Add one above — specialties and subjects
            all live under an exam.
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {exams.map((exam) => (
            <li key={exam.id} className="flex">
              <ExamSummaryCard exam={exam} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExamSummaryCard({ exam }: { exam: OrgExamCard }) {
  const href = `/org/content/exams/${exam.id}`;

  return (
    <Card className="relative flex-1 transition-shadow [--card-spacing:--spacing(5)] hover:ring-2 hover:ring-primary/30 focus-within:ring-2 focus-within:ring-primary/30">
      <CardHeader>
        <CardTitle className="font-display text-lg">
          {/* Stretched link: the whole card is the target. */}
          <Link href={href} className="after:absolute after:inset-0">
            {exam.name}
          </Link>
        </CardTitle>
        <CardDescription>
          {exam.publishedCount < exam.questionCount ? (
            <Badge variant="secondary">
              {exam.questionCount - exam.publishedCount} draft
              {exam.questionCount - exam.publishedCount === 1 ? "" : "s"}
            </Badge>
          ) : (
            <span className="text-xs">Private bank</span>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <dl className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-center">
          <Stat label="Specialties" value={exam.specialtyCount} />
          <Stat label="Subjects" value={exam.subjectCount} />
          <Stat label="Questions" value={exam.publishedCount} />
        </dl>
      </CardContent>

      <CardFooter className="justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {exam.specialtyCount === 0
            ? "Add a specialty to start filing content."
            : exam.publishedCount === 0
              ? "Nothing published yet — drafts never reach members."
              : "Live for your members."}
        </p>
        <Button variant="outline" size="sm" className="relative z-10" asChild>
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
