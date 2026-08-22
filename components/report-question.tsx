"use client";

import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { OpenReport } from "@/lib/question-reports";
import {
  canWithdraw,
  REPORT_CATEGORIES,
  REPORT_CATEGORY_LABELS,
  REPORT_NOTE_MAX,
} from "@/lib/question-reports-core";
import type { QuestionReportCategory } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * The student's "Report a problem" controls (question-reports-spec.md §2).
 * Two shapes on purpose — a silent toggling tap mid-test, a dialog
 * everywhere else — and BOTH are deliberately unlike "flag for review",
 * which keeps its palette placement and keyboard shortcut: this is a small
 * text link under the stem with no shortcut.
 */

const linkClass =
  "text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:no-underline disabled:opacity-70";

/** The one client call for POST /api/question-reports. */
export async function postReport(body: {
  questionId: string;
  testId?: string;
  category?: QuestionReportCategory;
  note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/question-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: data?.error };
  } catch {
    return { ok: false };
  }
}

/** The one client call for DELETE /api/question-reports (mid-test undo). */
export async function withdrawReport(body: {
  questionId: string;
  testId: string;
}): Promise<{ ok: boolean }> {
  try {
    const res = await fetch("/api/question-reports", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

/**
 * Mid-test: one tap files a bare report immediately (no category, no note —
 * the clock does not stop) and toggles so a mis-tap can be undone. State is
 * OWNED BY THE RUNNER (`report`/`onChange`): this component remounts on
 * every question change, so local state would forget an in-session toggle.
 * Undo is offered only when the server would honour it (canWithdraw) — a
 * report filed from another paper or already categorised is final.
 */
export function ReportQuestionTap({
  testId,
  questionId,
  report,
  onChange,
}: {
  testId: string;
  questionId: string;
  /** The student's open report on this question, if any. */
  report: OpenReport | null;
  onChange: (next: OpenReport | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const reported = report !== null;
  const withdrawable =
    report !== null &&
    canWithdraw({
      testStatus: "in_progress",
      reportTestId: report.testId,
      testId,
      category: report.category,
    });

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      if (!reported) {
        const { ok, error } = await postReport({ questionId, testId });
        if (!ok) throw new Error(error ?? "report");
        onChange({ questionId, testId, category: null });
      } else if (withdrawable) {
        const { ok } = await withdrawReport({ questionId, testId });
        if (!ok) throw new Error("withdraw");
        onChange(null);
      }
    } catch (e) {
      toast.error(
        reported
          ? "Could not undo the report."
          : e instanceof Error && e.message !== "report"
            ? e.message
            : "Could not report this question."
      );
    } finally {
      setBusy(false);
    }
  }

  if (reported && !withdrawable) {
    return <span className="text-xs text-muted-foreground">You reported this</span>;
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={reported}
      className={cn(linkClass, reported && "text-foreground")}
    >
      {reported ? "You reported this · undo" : "Report a problem"}
    </button>
  );
}

/**
 * Everywhere else (review, tutor reveal, bookmarks): a category is
 * required, a note is optional. `You reported this` persists for as long
 * as the report is open; once resolved the server stops returning it and
 * the control comes back — re-reporting the fixed version is new
 * information. Controlled (`reported`/`onReported`) for the same reason as
 * the tap: list filters and question navigation remount this component.
 */
export function ReportQuestionDialog({
  questionId,
  testId,
  reported,
  onReported,
}: {
  questionId: string;
  /** Where the student met it; omitted on /bookmarks. */
  testId?: string;
  reported: boolean;
  onReported: () => void;
}) {
  if (reported) {
    return <span className="text-xs text-muted-foreground">You reported this</span>;
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className={linkClass}>
          Report a problem
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <ReportForm
          questionId={questionId}
          testId={testId}
          onReported={onReported}
        />
      </DialogContent>
    </Dialog>
  );
}

function ReportForm({
  questionId,
  testId,
  onReported,
}: {
  questionId: string;
  testId?: string;
  onReported: () => void;
}) {
  const [category, setCategory] = useState<QuestionReportCategory | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!category) {
      setError("Pick what's wrong.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await postReport({
      questionId,
      testId,
      category,
      note: note.trim() || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not send the report. Try again.");
      return;
    }
    toast.success("Thanks — we'll take a look.");
    onReported();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-xl">
          Report a problem
        </DialogTitle>
        <DialogDescription>
          Wrong key, typo, outdated guideline — tell us and we&apos;ll check it.
          Your score for this question doesn&apos;t change.
        </DialogDescription>
      </DialogHeader>

      <CategoryPicker
        name={`report-${questionId}`}
        value={category}
        onChange={setCategory}
      />

      <div className="space-y-1.5">
        <Label htmlFor={`report-note-${questionId}`}>
          Note <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id={`report-note-${questionId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={REPORT_NOTE_MAX}
          rows={3}
          placeholder="What should it say instead?"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter className="gap-2 sm:gap-2">
        <DialogClose asChild>
          <Button variant="outline-muted">Cancel</Button>
        </DialogClose>
        <Button onClick={() => void submit()} disabled={submitting}>
          {submitting ? "Sending…" : "Send report"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Radio-style chips — one tap, no dropdown to open. */
export function CategoryPicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: QuestionReportCategory | null;
  onChange: (c: QuestionReportCategory) => void;
}) {
  return (
    <div role="radiogroup" aria-label="What's wrong?" className="flex flex-wrap gap-2">
      {REPORT_CATEGORIES.map((c) => {
        const active = value === c;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={active}
            name={name}
            onClick={() => onChange(c)}
            className={cn(
              "min-h-8 rounded-full border px-3 text-xs font-medium transition-colors",
              "focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:border-primary/50 hover:bg-accent"
            )}
          >
            {REPORT_CATEGORY_LABELS[c]}
          </button>
        );
      })}
    </div>
  );
}
