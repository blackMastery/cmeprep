"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createAssignment,
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type AssignmentExamOption = {
  id: string;
  name: string;
  isPrivate: boolean;
  subjects: {
    id: string;
    name: string;
    /** Rendered as its own column; never concatenated into `name`. */
    specialty: string;
    questionCount: number;
  }[];
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

/** ISO timestamp → the yyyy-mm-dd an <input type="date"> wants. due_at is
 * stored as end-of-day UTC, so the UTC date IS the chosen date. */
function dateInputValue(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * One form for both creating and editing, on two surfaces: the edit dialog
 * in the manager, and /org/assignments/new. Field ids default to field
 * names (AdminSelect has no id prop), so only ONE instance may exist at a
 * time — the dialog and the page never coexist.
 *
 * The action state lives HERE, not in the parent: the dialog unmounts the
 * form on close, so every open starts with a clean form and no stale
 * message from the last save. Errors stay inline next to the fields they
 * concern. How success is reported differs by surface, and that is what
 * `onDone` selects: the DIALOG passes it and closes + toasts (the list
 * behind it re-renders from the revalidated page), while the PAGE passes
 * nothing because createAssignment ends in a redirect back to the list —
 * a server redirect, so nothing here runs afterwards.
 *
 * When `editing.started > 0` the prescription is locked (SPEC §7 Editing):
 * the config fields render as a read-only summary plus hidden inputs, so
 * the action receives the unchanged config and its own rule (not the UI)
 * decides. The hidden inputs are what keep a locked save parseable.
 */
export function AssignmentForm({
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
  /** Dialog only. Absent = the page, where the action redirects instead. */
  onDone?: () => void;
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
    if (!onDone) return;
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

  // Ticked subjects, controlled so the header's select-all can drive them.
  const [selected, setSelected] = useState<Set<string>>(initialSubjects);
  // Switching exam clears the ticks — subject ids belong to one exam, and a
  // stale id fails the server's "those subjects don't belong to the chosen
  // exam" check. Adjusted during render (the React "state derived from a
  // changing prop" pattern) rather than in an effect, so the table never
  // paints one frame with the previous exam's selection.
  const [selectionExam, setSelectionExam] = useState(examId);
  if (selectionExam !== examId) {
    setSelectionExam(examId);
    setSelected(examId === initialExamId ? initialSubjects : new Set());
  }

  const subjects = exam?.subjects ?? [];
  const selectedCount = subjects.filter((s) => selected.has(s.id)).length;
  const allSelected = subjects.length > 0 && selectedCount === subjects.length;
  // The size of the pool the draw comes from: an admin asking for 40
  // questions out of 12 available should see that before they save.
  const pool = subjects
    .filter((s) => selected.has(s.id))
    .reduce((sum, s) => sum + s.questionCount, 0);

  const toggleSubject = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

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
      {/* Title takes two thirds: a date input needs no more room than the
          date, and an even split left it stretched across the page. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <AdminField
          label="Title"
          name="title"
          placeholder="Surgery mock — week 6"
          defaultValue={editing?.title}
          required
          className="sm:col-span-2"
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
              <>
                {/* Bounded scroll rather than letting the dialog grow: a
                    bank with 30 subjects otherwise pushes Create off the
                    screen, and the dialog's own scroll loses the header. */}
                <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            aria-label={
                              allSelected ? "Clear all subjects" : "Select all subjects"
                            }
                            checked={
                              allSelected
                                ? true
                                : selectedCount > 0
                                  ? "indeterminate"
                                  : false
                            }
                            onCheckedChange={(next) =>
                              setSelected(
                                next === true
                                  ? new Set(subjects.map((s) => s.id))
                                  : new Set()
                              )
                            }
                          />
                        </TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead className="hidden sm:table-cell">
                          Specialty
                        </TableHead>
                        <TableHead className="text-right">Questions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {subjects.map((subject) => {
                        const checked = selected.has(subject.id);
                        return (
                          <TableRow
                            key={subject.id}
                            data-state={checked ? "selected" : undefined}
                          >
                            <TableCell>
                              <Checkbox
                                id={`subject-${subject.id}`}
                                name="subjectIds"
                                value={subject.id}
                                checked={checked}
                                onCheckedChange={(next) =>
                                  toggleSubject(subject.id, next === true)
                                }
                              />
                            </TableCell>
                            {/* The label is the whole name cell, so the
                                click target is the row's text, not a 16px
                                box. */}
                            <TableCell className="whitespace-normal">
                              <Label
                                htmlFor={`subject-${subject.id}`}
                                className="font-normal"
                              >
                                {subject.name}
                              </Label>
                            </TableCell>
                            <TableCell className="hidden whitespace-normal text-muted-foreground sm:table-cell">
                              {subject.specialty}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {subject.questionCount}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {selectedCount === 0
                    ? `Nothing selected — pick at least one of ${subjects.length} subjects.`
                    : `${selectedCount} of ${subjects.length} subjects · ${pool} question${pool === 1 ? "" : "s"} to draw from.`}
                </p>
              </>
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
      {onDone ? (
        <DialogFooter className="gap-2 sm:gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline-muted">
              Cancel
            </Button>
          </DialogClose>
          <AdminSubmit>Save changes</AdminSubmit>
        </DialogFooter>
      ) : (
        // The page has no dialog to close: Cancel is a link back to the
        // list, the same place a successful create lands.
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline-muted" asChild>
            <Link href="/org/assignments">Cancel</Link>
          </Button>
          <AdminSubmit>Create assignment</AdminSubmit>
        </div>
      )}
    </form>
  );
}

