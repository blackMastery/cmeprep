"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, Pencil } from "lucide-react";
import { toast } from "sonner";
import type { ReportRollup, Ruling } from "@/lib/admin/question-reports";
import type { PickSplit } from "@/lib/question-reports-core";
import {
  REPORT_CATEGORY_LABELS,
  REPORT_NOTE_MAX,
  REPORT_RATE_FLOOR,
  REPORT_RESOLUTION_LABELS,
  REPORT_RESOLUTIONS,
} from "@/lib/question-reports-core";
import type { QuestionReportCategory, QuestionReportResolution } from "@/lib/supabase/types";
import {
  resolveQuestionReports,
  type QuestionState,
} from "@/app/admin/questions/actions";
import { cn } from "@/lib/utils";
import { questionImageUrl } from "@/lib/storage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { AdminSelect, AdminSubmit } from "@/components/admin/form-parts";
import { FormMessage } from "@/components/auth/form-parts";
import { QuestionImage } from "@/components/test/question-image";

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const LETTERS = "ABCDEFGH".split("");

/**
 * One card per reported question (question-reports-spec.md §3). Resolving
 * resolves the QUESTION — every open report on it closes at once under one
 * ruling. Nothing here changes what students see.
 */
export function QuestionReportsQueue({
  rollups,
  view,
  editorBasePath,
}: {
  rollups: ReportRollup[];
  view: "open" | "resolved";
  editorBasePath: string;
}) {
  if (rollups.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="font-display text-lg">
            {view === "open" ? "Nothing reported." : "No resolved reports yet."}
          </p>
          {view === "open" && (
            <p className="mt-1 text-sm text-muted-foreground">
              Students can report a question from a test, its review, or a
              bookmark. Reported questions land here ranked by how often.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <ol className="space-y-4">
      {rollups.map((r, i) => (
        <li key={`${r.questionId}-${r.ruling?.resolvedAt ?? "open"}`}>
          <RollupCard
            rollup={r}
            rank={i + 1}
            view={view}
            editorBasePath={editorBasePath}
          />
        </li>
      ))}
    </ol>
  );
}

function RollupCard({
  rollup: r,
  rank,
  view,
  editorBasePath,
}: {
  rollup: ReportRollup;
  rank: number;
  view: "open" | "resolved";
  editorBasePath: string;
}) {
  const [showEvidence, setShowEvidence] = useState(rank <= 3 && view === "open");
  const ratePct = r.rate === null ? null : Math.round(r.rate * 1000) / 10;
  const floored = r.reporters < REPORT_RATE_FLOOR;

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        {/* Header: numbers first, always both */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium tabular-nums text-muted-foreground">
            #{rank}
          </span>
          <Badge variant="secondary">{r.examName}</Badge>
          <Badge variant="outline">{r.subjectName}</Badge>
          {r.deletedAt ? (
            <Badge variant="outline">Deleted</Badge>
          ) : r.isPublished ? null : (
            <Badge variant="secondary">Draft</Badge>
          )}
          <span className="ml-auto flex items-center gap-3 tabular-nums">
            <span>
              <span className="font-semibold text-foreground">{r.reporters}</span>{" "}
              reporter{r.reporters === 1 ? "" : "s"}
            </span>
            <span>
              <span className="font-semibold text-foreground">
                {r.attempts.toLocaleString("en-GB")}
              </span>{" "}
              attempt{r.attempts === 1 ? "" : "s"}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-semibold",
                floored
                  ? "bg-muted text-muted-foreground"
                  : "bg-destructive/10 text-destructive"
              )}
              title={
                floored
                  ? `Ranked by reporter count until ${REPORT_RATE_FLOOR} distinct reporters`
                  : "Distinct reporters ÷ attempts"
              }
            >
              {ratePct === null ? "— %" : `${ratePct}%`}
            </span>
          </span>
        </div>

        {/* Carried-forward ruling */}
        {r.previousRuling && view === "open" && (
          <RulingStrip ruling={r.previousRuling} label="Previously ruled" />
        )}
        {r.ruling && view === "resolved" && (
          <RulingStrip ruling={r.ruling} label="Resolved" />
        )}

        {/* The question */}
        <div className="space-y-3">
          <p className="font-display leading-relaxed">{r.stem}</p>
          {questionImageUrl(r.imagePath) && (
            <QuestionImage src={questionImageUrl(r.imagePath)!} />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {categoryChips(r.categories)}
            <Button
              variant="outline-muted"
              size="sm"
              className="ml-auto"
              asChild
            >
              <Link href={`${editorBasePath}/${r.questionId}`}>
                <Pencil data-icon="inline-start" />
                Open in editor
              </Link>
            </Button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowEvidence((v) => !v)}
          aria-expanded={showEvidence}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronDown
            className={cn("size-3.5 transition-transform", showEvidence && "rotate-180")}
          />
          {showEvidence ? "Hide" : "Show"} key, picks and notes
        </button>

        {showEvidence && (
          <div className="space-y-5 border-t border-border pt-4">
            <PickSplitView picks={r.picks} updatedAt={r.contentUpdatedAt} />

            <div>
              <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Explanation
              </p>
              <p className="text-sm leading-relaxed text-foreground/90">
                {r.explanation || <span className="italic">none</span>}
              </p>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Reports ({r.reports.length})
              </p>
              <ul className="space-y-2">
                {r.reports.map((n) => (
                  <li key={n.reportId} className="text-sm">
                    <span className="font-medium">{n.userName}</span>
                    {n.email && (
                      <span className="text-muted-foreground"> · {n.email}</span>
                    )}
                    <span className="text-muted-foreground">
                      {" "}
                      · {dateTimeFmt.format(new Date(n.createdAt))}
                    </span>
                    {n.category ? (
                      <Badge variant="outline" className="ml-2">
                        {REPORT_CATEGORY_LABELS[n.category]}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="ml-2">
                        mid-test tap
                      </Badge>
                    )}
                    {n.note && (
                      <p className="mt-0.5 text-muted-foreground">{n.note}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {view === "open" && <ResolveForm questionId={r.questionId} />}
      </CardContent>
    </Card>
  );
}

function categoryChips(categories: ReportRollup["categories"]) {
  const entries = Object.entries(categories) as [
    QuestionReportCategory | "bare",
    number,
  ][];
  entries.sort((a, b) => b[1] - a[1]);
  return entries.map(([c, n]) => (
    <span
      key={c}
      className="rounded-full bg-muted px-2.5 py-1 text-xs tabular-nums"
    >
      {c === "bare" ? "No category" : REPORT_CATEGORY_LABELS[c]} · {n}
    </span>
  ));
}

function RulingStrip({ ruling, label }: { ruling: Ruling; label: string }) {
  const tone =
    ruling.resolution === "no_change"
      ? "border-sun bg-sun/15"
      : ruling.resolution === "fixed"
        ? "border-success bg-success/10"
        : "border-border bg-muted";
  return (
    <div className={cn("rounded-xl border-l-2 px-4 py-3 text-sm", tone)}>
      <p>
        <span className="text-xs font-semibold tracking-wide uppercase">
          {label}:{" "}
        </span>
        <span className="font-medium">
          {REPORT_RESOLUTION_LABELS[ruling.resolution]}
        </span>
        <span className="text-muted-foreground">
          {" "}
          · {ruling.resolvedBy} · {dateFmt.format(new Date(ruling.resolvedAt))}
        </span>
      </p>
      {ruling.note && <p className="mt-1 text-muted-foreground">{ruling.note}</p>}
    </div>
  );
}

/** What everyone actually picked, split at the last edit. */
function PickSplitView({
  picks,
  updatedAt,
}: {
  picks: PickSplit;
  updatedAt: string | null;
}) {
  const editLabel = updatedAt ? dateFmt.format(new Date(updatedAt)) : "—";
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <PickColumn
        title={`Since last edit (${editLabel})`}
        attempts={picks.since.attempts}
        options={picks.since.options}
      />
      <PickColumn
        title="Before the edit"
        attempts={picks.before.attempts}
        options={picks.before.options}
        muted
      />
    </div>
  );
}

function PickColumn({
  title,
  attempts,
  options,
  muted = false,
}: {
  title: string;
  attempts: number;
  options: PickSplit["since"]["options"];
  muted?: boolean;
}) {
  return (
    <div>
      <p className="mb-2 flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {attempts.toLocaleString("en-GB")} attempt{attempts === 1 ? "" : "s"}
        </span>
      </p>
      {attempts === 0 ? (
        <p className="text-xs text-muted-foreground italic">No attempts.</p>
      ) : (
        <ul className="space-y-1.5">
          {options.map((o, i) => (
            <li key={o.optionId} className="text-xs">
              <div className="mb-0.5 flex items-center gap-2">
                <span
                  className={cn(
                    "w-4 shrink-0 font-semibold tabular-nums",
                    o.isCorrect ? "text-success" : "text-muted-foreground"
                  )}
                >
                  {LETTERS[i] ?? i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate" title={o.label}>
                  {o.label}
                </span>
                {o.isCorrect && (
                  <span className="shrink-0 text-success" aria-label="answer key">
                    ✓ key
                  </span>
                )}
                <span className="w-9 shrink-0 text-right tabular-nums">
                  {o.percent}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn(
                    "h-full rounded-full",
                    o.isCorrect ? "bg-success" : muted ? "bg-muted-foreground/40" : "bg-primary"
                  )}
                  style={{ width: `${o.percent}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** An outcome, not just a timestamp. */
function ResolveForm({ questionId }: { questionId: string }) {
  const [state, action] = useActionState<QuestionState, FormData>(
    resolveQuestionReports,
    null
  );
  const [resolution, setResolution] = useState<QuestionReportResolution>("fixed");

  useEffect(() => {
    if (state?.success) toast.success(state.success);
  }, [state]);

  return (
    <form
      action={action}
      className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end"
    >
      <input type="hidden" name="questionId" value={questionId} />
      <AdminSelect
        label="Resolve as"
        name="resolution"
        value={resolution}
        onChange={(e) => setResolution(e.target.value as QuestionReportResolution)}
        className="sm:w-44"
        hint={
          resolution === "no_change"
            ? "Carried forward if it's reported again."
            : resolution === "fixed"
              ? "Or tick “Resolve as fixed” when you save the edit."
              : "Can't be fixed — e.g. the question is retired."
        }
      >
        {REPORT_RESOLUTIONS.map((r) => (
          <option key={r} value={r}>
            {REPORT_RESOLUTION_LABELS[r]}
          </option>
        ))}
      </AdminSelect>
      <div className="flex-1 space-y-1.5">
        <label htmlFor={`note-${questionId}`} className="text-sm font-medium">
          Note <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea
          id={`note-${questionId}`}
          name="note"
          rows={1}
          maxLength={REPORT_NOTE_MAX}
          placeholder="Why — the next admin reads this."
        />
      </div>
      <div className="space-y-2">
        <AdminSubmit variant="outline">Resolve question</AdminSubmit>
      </div>
      {state?.error && (
        <div className="sm:basis-full">
          <FormMessage error={state.error} />
        </div>
      )}
    </form>
  );
}
