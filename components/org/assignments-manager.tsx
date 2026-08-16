"use client";

import { useActionState, useMemo, useState } from "react";
import {
  createAssignment,
  deleteAssignment,
} from "@/app/(app)/org/(manage)/assignments/actions";
import type { OrgActionState } from "@/app/(app)/org/(manage)/members/actions";
import {
  AdminField,
  AdminSelect,
  AdminSubmit,
  AdminTextarea,
} from "@/components/admin/form-parts";
import { FormMessage } from "@/components/auth/form-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export type AssignmentExamOption = {
  id: string;
  name: string;
  isPrivate: boolean;
  subjects: { id: string; name: string; questionCount: number }[];
};

export type AssignmentRow = {
  id: string;
  title: string;
  dueAt: string;
  audience: "all" | "selected" | "department";
  numQuestions: number;
  mode: "exam" | "tutor";
  /** Null exactly when mode='tutor' — tutor prescriptions are untimed. */
  durationMin: number | null;
  targeted: number;
  completed: number;
  late: number;
  /** Completions done in tutor mode (member override) — counted, labeled. */
  completedTutor: number;
  /** For department audiences; null there means the department was deleted. */
  departmentName: string | null;
};

export type MemberOption = { userId: string; label: string };

export type DepartmentOption = { id: string; name: string };

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function AssignmentsManager({
  exams,
  members,
  departments,
  rows,
}: {
  exams: AssignmentExamOption[];
  members: MemberOption[];
  departments: DepartmentOption[];
  rows: AssignmentRow[];
}) {
  const [createState, createAction] = useActionState<OrgActionState, FormData>(
    createAssignment,
    null
  );
  const [deleteState, deleteAction] = useActionState<OrgActionState, FormData>(
    deleteAssignment,
    null
  );

  const [examId, setExamId] = useState(exams[0]?.id ?? "");
  const [mode, setMode] = useState<"exam" | "tutor">("exam");
  const [audience, setAudience] = useState<"all" | "selected" | "department">(
    "all"
  );
  const exam = useMemo(
    () => exams.find((e) => e.id === examId) ?? null,
    [exams, examId]
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>New assignment</CardTitle>
          <CardDescription>
            Members get exactly this test — same subjects, length and format —
            with a due date. They can retake it; the latest submitted score is
            what your dashboard reports. Tutor-mode assignments are untimed
            with instant explanations, and count as done only once every
            question is answered.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createAction} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <AdminField
                label="Title"
                name="title"
                placeholder="Surgery mock — week 6"
                required
              />
              <AdminField label="Due date" name="dueDate" type="date" required />
            </div>
            <AdminTextarea
              label="Instructions (optional)"
              name="description"
              rows={2}
              placeholder="Sit this under exam conditions."
            />

            <div className="grid gap-4 sm:grid-cols-4">
              <AdminSelect
                label="Exam"
                name="examId"
                value={examId}
                onChange={(e) => setExamId(e.target.value)}
                className="sm:col-span-2"
              >
                {exams.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.isPrivate ? " (your bank)" : ""}
                  </option>
                ))}
              </AdminSelect>
              <AdminSelect
                label="Mode"
                name="mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as "exam" | "tutor")}
              >
                <option value="exam">Exam (timed)</option>
                <option value="tutor">Tutor (untimed)</option>
              </AdminSelect>
              <AdminSelect label="Difficulty" name="difficulty" defaultValue="mixed">
                <option value="mixed">Mixed</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </AdminSelect>
              <div className="grid grid-cols-2 gap-2">
                <AdminField
                  label="Questions"
                  name="numQuestions"
                  type="number"
                  min={5}
                  max={100}
                  defaultValue={20}
                />
                {/* Tutor sessions are untimed — no duration is submitted. */}
                {mode === "exam" && (
                  <AdminField
                    label="Minutes"
                    name="durationMin"
                    type="number"
                    min={5}
                    max={240}
                    defaultValue={30}
                  />
                )}
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Subjects</legend>
              {!exam || exam.subjects.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This exam has no subjects with published questions yet.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {exam.subjects.map((subject) => (
                    <Label
                      key={subject.id}
                      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 font-normal"
                    >
                      <Checkbox name="subjectIds" value={subject.id} />
                      <span className="min-w-0 flex-1 truncate">
                        {subject.name}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {subject.questionCount}
                      </span>
                    </Label>
                  ))}
                </div>
              )}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Who</legend>
              <AdminSelect
                label="Audience"
                name="audience"
                value={audience}
                onChange={(e) =>
                  setAudience(
                    e.target.value as "all" | "selected" | "department"
                  )
                }
                className="max-w-56"
              >
                <option value="all">Everyone in the organisation</option>
                <option value="selected">Selected members</option>
                {departments.length > 0 && (
                  <option value="department">A department</option>
                )}
              </AdminSelect>
              {audience === "department" && (
                <AdminSelect
                  label="Department"
                  name="departmentId"
                  defaultValue={departments[0]?.id ?? ""}
                  hint="Dynamic: whoever is in the department sees it — people moved in before the due date included."
                  className="max-w-56"
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </AdminSelect>
              )}
              {audience === "selected" && (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {members.map((member) => (
                    <Label
                      key={member.userId}
                      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 font-normal"
                    >
                      <Checkbox name="targetIds" value={member.userId} />
                      <span className="min-w-0 flex-1 truncate">
                        {member.label}
                      </span>
                    </Label>
                  ))}
                </div>
              )}
            </fieldset>

            <FormMessage error={createState?.error} success={createState?.success} />
            <AdminSubmit>Create assignment</AdminSubmit>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Open assignments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <FormMessage error={deleteState?.error} success={deleteState?.success} />
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing assigned yet.
            </p>
          )}
          <ul className="space-y-3">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{row.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Due {shortDate(row.dueAt)} · {row.numQuestions} questions ·{" "}
                    {row.mode === "tutor" ? "Tutor" : `${row.durationMin} min`} ·{" "}
                    {row.audience === "all"
                      ? "everyone"
                      : row.audience === "department"
                        ? (row.departmentName ??
                          `${row.targeted} member${row.targeted === 1 ? "" : "s"}`)
                        : `${row.targeted} member${row.targeted === 1 ? "" : "s"}`}
                  </p>
                </div>
                {row.audience === "department" &&
                row.departmentName === null ? (
                  // The department was hard-deleted: the assignment reaches
                  // nobody, and a 0/0 count would only obscure that.
                  <Badge variant="destructive">Department deleted</Badge>
                ) : (
                  <Badge
                    variant={
                      row.completed >= row.targeted && row.targeted > 0
                        ? "default"
                        : "secondary"
                    }
                  >
                    {row.completed}/{row.targeted} done
                    {row.late > 0 ? ` · ${row.late} late` : ""}
                    {/* Overrides count but are labeled: a tutor completion of
                        an exam assignment is real work, differently done. */}
                    {row.completedTutor > 0 && row.mode === "exam"
                      ? ` · ${row.completedTutor} in tutor mode`
                      : ""}
                  </Badge>
                )}
                <form
                  action={deleteAction}
                  onSubmit={(event) => {
                    if (!window.confirm(`Remove "${row.title}"?`)) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="assignmentId" value={row.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                  >
                    Remove
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
