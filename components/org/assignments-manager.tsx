"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createAssignment,
  deleteAssignment,
  updateAssignment,
} from "@/app/org/assignments/actions";
import type { OrgActionState } from "@/app/org/members/actions";
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export type AssignmentExamOption = {
  id: string;
  name: string;
  isPrivate: boolean;
  subjects: { id: string; name: string; questionCount: number }[];
};

type Audience = "all" | "selected" | "department";
type Mode = "exam" | "tutor";

export type AssignmentRow = {
  id: string;
  title: string;
  description: string | null;
  dueAt: string;
  /** Optimistic-concurrency token the edit form echoes back. */
  updatedAt: string;
  audience: Audience;
  departmentId: string | null;
  /** Current targets (audience='selected') — pre-ticked on edit. */
  targetIds: string[];
  examId: string;
  examName: string;
  subjectIds: string[];
  subjectNames: string[];
  difficulty: "easy" | "medium" | "hard" | "mixed";
  numQuestions: number;
  mode: Mode;
  /** Null exactly when mode='tutor' — tutor prescriptions are untimed. */
  durationMin: number | null;
  targeted: number;
  completed: number;
  late: number;
  /** Completions done in tutor mode (member override) — counted, labeled. */
  completedTutor: number;
  /** For department audiences; null there means the department was deleted. */
  departmentName: string | null;
  /** Members with any attempt. Non-zero locks the prescription on edit. */
  started: number;
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

/** ISO timestamp → the yyyy-mm-dd an <input type="date"> wants. due_at is
 * stored as end-of-day UTC, so the UTC date IS the chosen date. */
function dateInputValue(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * One form for both creating and editing, mounted inside the dialog. Field
 * ids default to field names (AdminSelect has no id prop), so only ONE
 * instance may exist at a time — the single dialog guarantees that.
 *
 * The action state lives HERE, not in the manager: the dialog unmounts the
 * form on close, so every open starts with a clean form and no stale
 * message from the last save. Success closes the dialog and toasts (the
 * list behind it re-renders from the revalidated page); errors stay inline
 * next to the fields they concern.
 *
 * When `editing.started > 0` the prescription is locked (SPEC §7 Editing):
 * the config fields render as a read-only summary plus hidden inputs, so
 * the action receives the unchanged config and its own rule (not the UI)
 * decides. The hidden inputs are what keep a locked save parseable.
 */
function AssignmentForm({
  exams,
  members,
  departments,
  editing,
  onDone,
}: {
  exams: AssignmentExamOption[];
  members: MemberOption[];
  departments: DepartmentOption[];
  editing: AssignmentRow | null;
  onDone: () => void;
}) {
  const [state, submit] = useActionState<OrgActionState, FormData>(
    editing ? updateAssignment : createAssignment,
    null
  );
  // Fires once per success: the revalidated page can re-render the parent
  // (new onDone identity) before the close commits, and without the guard
  // that second pass would toast again.
  const finished = useRef(false);
  useEffect(() => {
    if (state?.success && !finished.current) {
      finished.current = true;
      toast.success(state.success);
      onDone();
    }
  }, [state, onDone]);

  const configLocked = editing !== null && editing.started > 0;
  const initialExamId = editing?.examId ?? exams[0]?.id ?? "";

  const [examId, setExamId] = useState(initialExamId);
  const [mode, setMode] = useState<Mode>(editing?.mode ?? "exam");
  const [audience, setAudience] = useState<Audience>(
    editing?.audience ?? "all"
  );

  const exam = useMemo(
    () => exams.find((e) => e.id === examId) ?? null,
    [exams, examId]
  );
  const initialTargets = useMemo(
    () => new Set(editing?.targetIds ?? []),
    [editing]
  );
  const initialSubjects = useMemo(
    () => new Set(editing?.subjectIds ?? []),
    [editing]
  );

  return (
    <form action={submit} className="space-y-4">
      {editing && (
        <>
          <input type="hidden" name="assignmentId" value={editing.id} />
          <input
            type="hidden"
            name="expectedUpdatedAt"
            value={editing.updatedAt}
          />
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          label="Title"
          name="title"
          placeholder="Surgery mock — week 6"
          defaultValue={editing?.title}
          required
        />
        <AdminField
          label="Due date"
          name="dueDate"
          type="date"
          defaultValue={editing ? dateInputValue(editing.dueAt) : undefined}
          hint={
            editing
              ? "Late is judged against the current due date: moving it earlier makes past submissions read as late; later forgives them."
              : undefined
          }
          required
        />
      </div>
      <AdminTextarea
        label="Instructions (optional)"
        name="description"
        rows={2}
        placeholder="Sit this under exam conditions."
        defaultValue={editing?.description ?? undefined}
      />

      {configLocked && editing ? (
        <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <p className="font-medium">
            Prescription locked — {editing.started} member
            {editing.started === 1 ? " has" : "s have"} already started.
          </p>
          <p className="text-muted-foreground">
            {editing.examName} · {editing.numQuestions} questions ·{" "}
            {editing.mode === "tutor"
              ? "tutor (untimed)"
              : `exam, ${editing.durationMin} min`}{" "}
            · {editing.difficulty} difficulty
          </p>
          <p className="text-muted-foreground">
            {editing.subjectNames.join(", ")}
          </p>
          <input type="hidden" name="examId" value={editing.examId} />
          {editing.subjectIds.map((id) => (
            <input key={id} type="hidden" name="subjectIds" value={id} />
          ))}
          <input type="hidden" name="difficulty" value={editing.difficulty} />
          <input type="hidden" name="numQuestions" value={editing.numQuestions} />
          <input type="hidden" name="mode" value={editing.mode} />
          {editing.mode === "exam" && editing.durationMin !== null && (
            <input type="hidden" name="durationMin" value={editing.durationMin} />
          )}
        </div>
      ) : (
        <>
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
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              <option value="exam">Exam (timed)</option>
              <option value="tutor">Tutor (untimed)</option>
            </AdminSelect>
            <AdminSelect
              label="Difficulty"
              name="difficulty"
              defaultValue={editing?.difficulty ?? "mixed"}
            >
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
                defaultValue={editing?.numQuestions ?? 20}
              />
              {/* Tutor sessions are untimed — no duration is submitted. */}
              {mode === "exam" && (
                <AdminField
                  label="Minutes"
                  name="durationMin"
                  type="number"
                  min={5}
                  max={240}
                  defaultValue={editing?.durationMin ?? 30}
                />
              )}
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Subjects</legend>
            {/* The exam list is entitlement-filtered, so "no exams at all"
                means the org's plan lapsed — saying the exam has no
                subjects sent admins hunting through the question bank. */}
            {exams.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No examinations available to assign. Your organisation needs
                an active plan for an examination before you can set work on
                it.
              </p>
            ) : !exam || exam.subjects.length === 0 ? (
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
                    <Checkbox
                      name="subjectIds"
                      value={subject.id}
                      defaultChecked={
                        examId === initialExamId && initialSubjects.has(subject.id)
                      }
                    />
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
        </>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Who</legend>
        <AdminSelect
          label="Audience"
          name="audience"
          value={audience}
          onChange={(e) => setAudience(e.target.value as Audience)}
          hint={
            editing && editing.started > 0
              ? "Anyone who has already started must stay in the audience."
              : undefined
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
            defaultValue={editing?.departmentId ?? departments[0]?.id ?? ""}
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
                <Checkbox
                  name="targetIds"
                  value={member.userId}
                  defaultChecked={initialTargets.has(member.userId)}
                />
                <span className="min-w-0 flex-1 truncate">{member.label}</span>
              </Label>
            ))}
          </div>
        )}
      </fieldset>

      <FormMessage error={state?.error} />
      <DialogFooter className="gap-2 sm:gap-2">
        <DialogClose asChild>
          <Button type="button" variant="outline-muted">
            Cancel
          </Button>
        </DialogClose>
        <AdminSubmit>
          {editing ? "Save changes" : "Create assignment"}
        </AdminSubmit>
      </DialogFooter>
    </form>
  );
}

type DialogState = { kind: "create" } | { kind: "edit"; id: string } | null;

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
  const [deleteState, deleteAction] = useActionState<OrgActionState, FormData>(
    deleteAssignment,
    null
  );
  const [dialog, setDialog] = useState<DialogState>(null);
  // Resolved from the live rows, so a stale id (row removed elsewhere while
  // the dialog was open) simply closes it rather than editing a ghost.
  const editing =
    dialog?.kind === "edit"
      ? (rows.find((r) => r.id === dialog.id) ?? null)
      : null;
  const open = dialog?.kind === "create" || editing !== null;

  return (
    <div className="space-y-6">
      <Dialog open={open} onOpenChange={(next) => !next && setDialog(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {editing ? `Edit “${editing.title}”` : "New assignment"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Members already working on it keep the test they started. Changes apply to everyone who opens it from now on, and are noted in the audit log."
                : "Members get exactly this test — same subjects, length and format — with a due date. They can retake it; the latest submitted score is what your dashboard reports. Tutor-mode assignments are untimed with instant explanations, and count as done only once every question is answered."}
            </DialogDescription>
          </DialogHeader>
          {/* Keyed so switching rows, or reopening after a save (new
              updatedAt), remounts the form with fresh defaults. */}
          {open && (
            <AssignmentForm
              key={editing ? `${editing.id}:${editing.updatedAt}` : "create"}
              exams={exams}
              members={members}
              departments={departments}
              editing={editing}
              onDone={() => setDialog(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Open assignments</CardTitle>
            <CardDescription>
              Prescribed tests with a due date. Edit changes the title,
              instructions, due date and audience; the test itself locks
              once anyone has started.
            </CardDescription>
          </div>
          <Button type="button" onClick={() => setDialog({ kind: "create" })}>
            New assignment
          </Button>
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDialog({ kind: "edit", id: row.id })}
                >
                  Edit
                </Button>
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
