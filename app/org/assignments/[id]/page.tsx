import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, Pencil } from "lucide-react";
import { listOrgMembers, requireOrgAdmin } from "@/lib/orgs";
import { findAssignmentRow } from "@/lib/org-assignments-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = { title: "Assignment" };

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const DIFFICULTY_LABEL = {
  mixed: "Mixed",
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
} as const;

/**
 * Preview one assignment: what members receive, what it draws on, who it
 * reaches and how it is going.
 *
 * Deliberately NOT a sample of the questions themselves. The prescription
 * spans public exams an org buys access to rather than owns, and the
 * question bank is the product — an org admin reads their own bank at
 * /org/content, and nothing here widens that. What this page previews is
 * the assignment: the card a member sees, and the pool it will draw from.
 */
export default async function OrgAssignmentPage(
  props: PageProps<"/org/assignments/[id]">
) {
  const session = await requireOrgAdmin();
  const { id } = await props.params;

  const row = await findAssignmentRow(session, id);
  if (!row) notFound();

  // Named members only for a hand-picked audience; "everyone" and a
  // department are counts, exactly as the list reports them.
  const named =
    row.audience === "selected" && row.targetIds.length > 0
      ? (await listOrgMembers(session.org.id))
          .filter((m) => row.targetIds.includes(m.member.user_id))
          .map((m) => m.profile?.full_name ?? m.email ?? "Unnamed member")
          .sort((a, b) => a.localeCompare(b))
      : [];

  // What the draw has to choose from. A prescription asking for more
  // questions than its subjects hold is the mistake this page exists to
  // catch before a member meets it.
  const pool = row.subjects.reduce((sum, s) => sum + s.questionCount, 0);
  const short = pool < row.numQuestions;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/org/assignments">
            <ArrowLeft data-icon="inline-start" />
            Assignments
          </Link>
        </Button>
        {/* h2: the org layout owns the page's h1 (the org name). */}
        <h2 className="min-w-0 flex-1 truncate font-display text-2xl font-semibold tracking-tight">
          {row.title}
        </h2>
        <Button asChild>
          <Link href={`/org/assignments/${row.id}/edit`}>
            <Pencil data-icon="inline-start" />
            Edit
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>What members see</CardTitle>
              <CardDescription>
                The card on their assignments page, as they will read it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* A still of the member's card (components/org/assignment-
                  list.tsx), without the launch controls — those need a
                  member's own standing, which an admin does not have. */}
              <div className="rounded-xl border border-border px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 font-medium">{row.title}</p>
                  <Badge variant="secondary">Not started</Badge>
                </div>
                {row.description && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {row.description}
                  </p>
                )}
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarClock className="size-3.5" aria-hidden="true" />
                  Due {longDate(row.dueAt)} · {row.numQuestions} questions ·{" "}
                  {row.mode === "tutor"
                    ? "Tutor, untimed"
                    : `${row.durationMin} minutes`}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>The test</CardTitle>
              <CardDescription>
                {row.examName} · {DIFFICULTY_LABEL[row.difficulty]} ·{" "}
                {row.mode === "tutor"
                  ? "Tutor mode, untimed with instant explanations"
                  : `Exam mode, ${row.durationMin} minutes`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subject</TableHead>
                      <TableHead className="hidden sm:table-cell">
                        Specialty
                      </TableHead>
                      <TableHead className="text-right">Questions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {row.subjects.map((subject) => (
                      <TableRow key={subject.id}>
                        <TableCell className="whitespace-normal">
                          {subject.name}
                        </TableCell>
                        <TableCell className="hidden whitespace-normal text-muted-foreground sm:table-cell">
                          {subject.specialty}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {subject.questionCount}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p
                className={`text-xs tabular-nums ${short ? "text-destructive" : "text-muted-foreground"}`}
              >
                {short
                  ? `Draws ${row.numQuestions} questions from a pool of ${pool} — members will get a shorter test than prescribed.`
                  : `Draws ${row.numQuestions} questions from a pool of ${pool}, so no two members sit the same paper.`}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Who</CardTitle>
              <CardDescription>
                {row.audience === "all"
                  ? "Everyone in the organisation"
                  : row.audience === "department"
                    ? (row.departmentName ?? "A deleted department")
                    : `${row.targetIds.length} selected member${row.targetIds.length === 1 ? "" : "s"}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {row.audience === "department" && row.departmentName === null ? (
                // Hard-deleted: the assignment reaches nobody, and a 0/0
                // count would only obscure that.
                <Badge variant="destructive">Department deleted</Badge>
              ) : (
                <>
                  {row.audience === "department" && (
                    <p className="text-sm text-muted-foreground">
                      Dynamic: whoever is in the department sees it, including
                      people moved in before the due date.
                    </p>
                  )}
                  {named.length > 0 && (
                    <ul className="space-y-1 text-sm">
                      {named.map((name) => (
                        <li key={name} className="truncate">
                          {name}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {row.targeted} member{row.targeted === 1 ? "" : "s"}{" "}
                    addressed.
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Progress</CardTitle>
              <CardDescription>
                Counted from the latest qualifying submission per member.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm tabular-nums">
              <p>
                <span className="font-display text-2xl">{row.completed}</span>
                <span className="text-muted-foreground">
                  {" "}
                  of {row.targeted} completed
                </span>
              </p>
              {row.late > 0 && (
                <p className="text-muted-foreground">{row.late} late</p>
              )}
              {row.completedTutor > 0 && row.mode === "exam" && (
                <p className="text-muted-foreground">
                  {row.completedTutor} done in tutor mode
                </p>
              )}
              <p className="text-muted-foreground">
                {row.started} started
                {row.started > 0 && " — the test itself is now locked"}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
