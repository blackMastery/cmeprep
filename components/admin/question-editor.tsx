"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Difficulty, Question, QuestionType } from "@/lib/supabase/types";
import type { ExistingOption } from "@/lib/admin/option-diff";
import { saveQuestion, type QuestionState } from "@/app/admin/questions/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormMessage } from "@/components/auth/form-parts";
import { AdminSelect, AdminSubmit } from "@/components/admin/form-parts";
import { QuestionPreview } from "@/components/admin/question-preview";
import { ImageUpload } from "@/components/admin/image-upload";
import { ConfirmAction } from "@/components/confirm-dialog";

type TopicOption = {
  id: string;
  name: string;
  subjectName: string;
  specialtyName: string;
};

/** Client-only row key, distinct from the DB id (absent on new rows). */
type Row = { key: string; id?: string; label: string; isCorrect: boolean };

export function QuestionEditor({
  topics,
  question,
  options,
  usageCount = 0,
}: {
  topics: TopicOption[];
  question?: Question;
  options?: ExistingOption[];
  usageCount?: number;
}) {
  const [state, formAction] = useActionState<QuestionState, FormData>(
    saveQuestion,
    null
  );

  const [type, setType] = useState<QuestionType>(question?.type ?? "mcq_single");
  const [imagePath, setImagePath] = useState<string | null>(
    question?.image_path ?? null
  );
  const [stem, setStem] = useState(question?.stem ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    options && options.length > 0
      ? options.map((o) => ({
          key: crypto.randomUUID(),
          id: o.id,
          label: o.label,
          isCorrect: o.is_correct,
        }))
      : [
          { key: crypto.randomUUID(), label: "", isCorrect: true },
          { key: crypto.randomUUID(), label: "", isCorrect: false },
        ]
  );

  const isMulti = type === "mcq_multi";
  const correctCount = rows.filter((r) => r.isCorrect).length;

  const keyWillChange = useMemo(() => {
    if (!options) return false;
    const before = new Set(
      options.filter((o) => !o.deleted_at && o.is_correct).map((o) => o.id)
    );
    const after = new Set(rows.filter((r) => r.isCorrect && r.id).map((r) => r.id));
    const newCorrect = rows.some((r) => r.isCorrect && !r.id);
    if (newCorrect) return true;
    if (before.size !== after.size) return true;
    for (const id of before) if (!after.has(id)) return true;
    return false;
  }, [options, rows]);

  const needsConfirm = keyWillChange && usageCount > 0;

  function selectCorrect(key: string) {
    setRows((prev) =>
      prev.map((r) =>
        isMulti
          ? r.key === key
            ? { ...r, isCorrect: !r.isCorrect }
            : r
          : { ...r, isCorrect: r.key === key }
      )
    );
  }

  function changeType(next: QuestionType) {
    setType(next);
    // Going multi → single with several correct rows would silently fail
    // validation; collapse to the first and say so.
    if (next !== "mcq_multi" && correctCount > 1) {
      let kept = false;
      setRows((prev) =>
        prev.map((r) => {
          if (r.isCorrect && !kept) {
            kept = true;
            return r;
          }
          return { ...r, isCorrect: false };
        })
      );
      toast("Kept the first correct option", {
        description: "Single-answer questions can only have one.",
      });
    }
  }

  const optionsPayload = JSON.stringify(
    rows.map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      label: r.label,
      isCorrect: r.isCorrect,
    }))
  );

  const fieldError = (key: string) => state?.fieldErrors?.[key];

  return (
    <form action={formAction} className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      {question && <input type="hidden" name="questionId" value={question.id} />}
      <input type="hidden" name="options" value={optionsPayload} />
      <input type="hidden" name="imagePath" value={imagePath ?? ""} />

      <div className="space-y-6">
        <FormMessage error={state?.error} success={state?.success} />

        <Card className="[--card-spacing:--spacing(5)]">
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <AdminSelect
                label="Topic"
                name="topicId"
                required
                defaultValue={question?.topic_id ?? ""}
                error={fieldError("topicId")}
              >
                <option value="" disabled>
                  Choose a topic…
                </option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.specialtyName} › {t.subjectName} › {t.name}
                  </option>
                ))}
              </AdminSelect>

              <AdminSelect
                label="Type"
                name="type"
                value={type}
                onChange={(e) => changeType(e.target.value as QuestionType)}
              >
                <option value="mcq_single">Single answer</option>
                <option value="mcq_multi">Multi answer</option>
                <option value="image_based">Image based</option>
              </AdminSelect>

              <AdminSelect
                label="Difficulty"
                name="difficulty"
                defaultValue={(question?.difficulty ?? "medium") as Difficulty}
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </AdminSelect>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="stem">Question stem</Label>
              <Textarea
                id="stem"
                name="stem"
                required
                rows={6}
                value={stem}
                onChange={(e) => setStem(e.target.value)}
                placeholder="A 58-year-old man presents with…"
                aria-invalid={fieldError("stem") ? true : undefined}
              />
              <p
                className={cn(
                  "text-xs",
                  fieldError("stem") ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {fieldError("stem") ?? "Plain text. This is what the student reads first."}
              </p>
            </div>

            <ImageUpload
              value={imagePath}
              onChange={setImagePath}
              required={type === "image_based"}
              error={fieldError("imagePath")}
            />
          </CardContent>
        </Card>

        <Card className="[--card-spacing:--spacing(5)]">
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-lg">Answer options</h2>
                <p className="text-xs text-muted-foreground">
                  {isMulti
                    ? "Mark at least two options correct."
                    : "Mark exactly one option correct."}
                </p>
              </div>
              <Badgeish
                tone={
                  isMulti
                    ? correctCount >= 2
                      ? "ok"
                      : "warn"
                    : correctCount === 1
                      ? "ok"
                      : "warn"
                }
              >
                {correctCount} correct
              </Badgeish>
            </div>

            {fieldError("options") && (
              <FormMessage error={fieldError("options")} />
            )}

            <ul className="space-y-2">
              {rows.map((row, index) => (
                <li
                  key={row.key}
                  className="flex items-start gap-2 rounded-lg border border-border p-2"
                >
                  <span className="mt-2 text-muted-foreground" aria-hidden="true">
                    <GripVertical className="size-4" />
                  </span>

                  <label className="mt-2 flex shrink-0 items-center gap-1.5 text-xs">
                    <input
                      type={isMulti ? "checkbox" : "radio"}
                      name="correctOption"
                      checked={row.isCorrect}
                      onChange={() => selectCorrect(row.key)}
                      className="size-4 accent-[var(--success)]"
                      aria-label={`Mark option ${index + 1} correct`}
                    />
                    Correct
                  </label>

                  <Input
                    value={row.label}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r) =>
                          r.key === row.key ? { ...r, label: e.target.value } : r
                        )
                      )
                    }
                    placeholder={`Option ${String.fromCharCode(65 + index)}`}
                    aria-label={`Option ${index + 1} text`}
                    className="h-9 flex-1"
                  />

                  <div className="flex shrink-0 items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === 0}
                      onClick={() =>
                        setRows((prev) => {
                          const next = [...prev];
                          [next[index - 1], next[index]] = [
                            next[index],
                            next[index - 1],
                          ];
                          return next;
                        })
                      }
                      aria-label={`Move option ${index + 1} up`}
                    >
                      ↑
                    </Button>
                    <RemoveOptionButton
                      index={index}
                      row={row}
                      disabled={rows.length <= 2}
                      onRemove={() =>
                        setRows((prev) => prev.filter((r) => r.key !== row.key))
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>

            <Button
              type="button"
              variant="outline-muted"
              size="sm"
              disabled={rows.length >= 8}
              onClick={() =>
                setRows((prev) => [
                  ...prev,
                  { key: crypto.randomUUID(), label: "", isCorrect: false },
                ])
              }
            >
              <Plus data-icon="inline-start" />
              Add option
            </Button>
          </CardContent>
        </Card>

        <Card className="[--card-spacing:--spacing(5)]">
          <CardContent className="space-y-1.5">
            <Label htmlFor="explanation">Explanation</Label>
            <Textarea
              id="explanation"
              name="explanation"
              required
              rows={5}
              defaultValue={question?.explanation ?? ""}
              placeholder="Why the correct answer is correct…"
              aria-invalid={fieldError("explanation") ? true : undefined}
            />
            <p
              className={cn(
                "text-xs",
                fieldError("explanation")
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {fieldError("explanation") ??
                "Shown in review mode after the test is submitted."}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sidebar: publish + live preview */}
      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <Card className="[--card-spacing:--spacing(5)]">
          <CardContent className="space-y-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                name="isPublished"
                defaultChecked={question?.is_published ?? false}
                className="size-4 accent-[var(--primary)]"
              />
              Published
            </label>
            <p className="text-xs text-muted-foreground">
              Drafts are invisible to students and never enter a test.
            </p>

            {needsConfirm && (
              <div className="space-y-2 rounded-lg bg-destructive/10 p-3">
                <p className="text-xs text-destructive">
                  This question has been used in {usageCount} test
                  {usageCount === 1 ? "" : "s"}. Changing the answer key will make
                  past reviews disagree with the scores already given.
                </p>
                <label className="flex items-start gap-2 text-xs text-destructive">
                  <input
                    type="checkbox"
                    name="confirmKeyChange"
                    value="true"
                    className="mt-0.5 size-4 accent-[var(--destructive)]"
                  />
                  I understand — change the answer key anyway
                </label>
              </div>
            )}

            <div className="flex gap-2 border-t border-border pt-4">
              <AdminSubmit className="flex-1">
                {question ? "Save changes" : "Create question"}
              </AdminSubmit>
              <Button variant="outline-muted" asChild>
                <Link href="/admin/questions">Cancel</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <QuestionPreview
          stem={stem}
          imagePath={imagePath}
          options={rows.map((r) => ({ label: r.label, isCorrect: r.isCorrect }))}
          multi={isMulti}
        />
      </aside>
    </form>
  );
}

/**
 * Removing an option means different things depending on the row:
 * a saved option gets retired on save (papers already sat keep it), an
 * unsaved one just disappears, and an untouched blank row isn't worth a
 * dialog at all.
 */
function RemoveOptionButton({
  index,
  row,
  disabled,
  onRemove,
}: {
  index: number;
  row: Row;
  disabled: boolean;
  onRemove: () => void;
}) {
  const label = `Remove option ${index + 1}`;
  const isBlankAndUnsaved = !row.id && row.label.trim().length === 0;

  if (isBlankAndUnsaved) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        onClick={onRemove}
        aria-label={label}
      >
        <Trash2 />
      </Button>
    );
  }

  return (
    <ConfirmAction
      size="icon-sm"
      disabled={disabled}
      triggerLabel={label}
      title="Remove this option?"
      confirmLabel="Remove option"
      onConfirm={onRemove}
      description={
        row.id ? (
          <>
            &ldquo;{row.label.trim() || "This option"}&rdquo; will be retired
            when you save. Papers students have already sat keep showing it;
            new tests won&apos;t include it.
          </>
        ) : (
          <>
            &ldquo;{row.label.trim()}&rdquo; hasn&apos;t been saved yet, so it
            will simply be discarded.
          </>
        )
      }
    >
      <Trash2 />
    </ConfirmAction>
  );
}

function Badgeish({
  tone,
  children,
}: {
  tone: "ok" | "warn";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium",
        tone === "ok"
          ? "bg-success/10 text-success"
          : "bg-destructive/10 text-destructive"
      )}
    >
      {children}
    </span>
  );
}
