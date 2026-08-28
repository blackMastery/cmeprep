"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CatalogExam } from "@/lib/catalog-core";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

/**
 * Pick the one exam this purchase buys.
 *
 * The selection lives in the URL (?exam=), not in local state: that makes the
 * wizard's locked-exam upsell deep-linkable for free, keeps the payload sane
 * (only the SELECTED exam's tree is rendered, by the server), and gets
 * back/refresh/share behaviour for nothing.
 *
 * Radix roving focus fires onValueChange on every arrow key, so arrowing
 * through several exams queues several router.replace calls. useOptimistic
 * keeps the highlight instant and the last transition wins.
 */
export function ExamChoice({
  basePath,
  exams,
  selectedId,
  ownedUntil,
  labelledBy,
  children,
}: {
  /**
   * The page this picker lives on — /checkout/{planId} or /org/billing.
   * A path, not a callback: server → client props must be serializable.
   */
  basePath: string;
  exams: CatalogExam[];
  selectedId: string | null;
  /** examId → the date access already runs to, for the "owned" badge. */
  ownedUntil: Record<string, string>;
  labelledBy: string;
  /** The selected exam's detail panel, rendered on the server. */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimisticId, setOptimisticId] = useOptimistic(selectedId);

  function choose(id: string) {
    if (id === selectedId) return;
    startTransition(() => {
      setOptimisticId(id);
      router.replace(`${basePath}?exam=${id}`, { scroll: false });
    });
  }

  // A single exam is auto-selected server-side. Asking for an explicit tick
  // on a group of one is friction with no information value — but the detail
  // panel still renders, so the buyer still sees what they're getting.
  if (exams.length === 1) {
    const only = exams[0];
    return (
      <div className="rounded-xl border border-primary bg-accent/40 p-4">
        <p className="font-display text-base wrap-break-word">{only.name}</p>
        <ExamMeta exam={only} until={ownedUntil[only.id]} />
        <div className="mt-4 border-t border-border pt-4">{children}</div>
      </div>
    );
  }

  return (
    <>
      <RadioGroup
        value={optimisticId ?? ""}
        onValueChange={choose}
        aria-labelledby={labelledBy}
        className="gap-3"
      >
        {exams.map((exam) => {
          const selected = exam.id === optimisticId;
          return (
            <div
              key={exam.id}
              className={cn(
                "relative rounded-xl border p-4 transition-colors",
                selected
                  ? "border-primary bg-accent/40"
                  : "border-border hover:border-primary/50 hover:bg-accent/30"
              )}
            >
              <div className="flex items-start gap-3">
                <RadioGroupItem
                  id={`exam-${exam.id}`}
                  value={exam.id}
                  className="mt-1.5"
                  aria-describedby={`exam-${exam.id}-meta`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Stretched label — the whole card is the hit target. */}
                    <Label
                      htmlFor={`exam-${exam.id}`}
                      className="font-display text-base wrap-break-word after:absolute after:inset-0"
                    >
                      {exam.name}
                    </Label>
                    {exam.code && (
                      <Badge variant="outline" className="font-mono">
                        {exam.code}
                      </Badge>
                    )}
                  </div>
                  <ExamMeta
                    exam={exam}
                    until={ownedUntil[exam.id]}
                    id={`exam-${exam.id}-meta`}
                  />
                </div>
              </div>

              {selected && (
                // relative z-10 lifts the disclosure buttons above the
                // stretched label overlay, which would otherwise swallow
                // every click inside the panel.
                <div
                  className="relative z-10 mt-4 border-t border-border pt-4"
                  aria-busy={pending || undefined}
                >
                  {/* `children` is the SERVER's selection. While the optimistic
                      highlight has moved but the fetch hasn't landed, it still
                      describes the previous exam — show a placeholder rather
                      than the wrong syllabus. */}
                  {pending ? <DetailPlaceholder /> : children}
                </div>
              )}
            </div>
          );
        })}
      </RadioGroup>

      {/* Focus does not move on selection, so announce it. */}
      <p role="status" className="sr-only">
        {optimisticId
          ? `${exams.find((e) => e.id === optimisticId)?.name} selected.`
          : ""}
      </p>
    </>
  );
}

function DetailPlaceholder() {
  return (
    <div className="space-y-4">
      <div className="h-16 animate-pulse rounded-lg bg-muted/50" />
      <div className="h-24 animate-pulse rounded-lg bg-muted/50" />
      <p className="sr-only">Loading examination details…</p>
    </div>
  );
}

function ExamMeta({
  exam,
  until,
  id,
}: {
  exam: CatalogExam;
  until?: string;
  id?: string;
}) {
  return (
    <p id={id} className="mt-1 text-sm text-muted-foreground">
      {exam.specialtyCount} specialt{exam.specialtyCount === 1 ? "y" : "ies"} ·{" "}
      {exam.subjectCount} subject{exam.subjectCount === 1 ? "" : "s"}
      {/* Bank size is deliberately hidden from buyers — it grows over time
          and reads as a coverage judgement it isn't.
      {" "}· {exam.questionCount.toLocaleString()} question
      {exam.questionCount === 1 ? "" : "s"} */}
      {until && (
        <>
          {" "}
          <span className="text-success">· owned until {until}</span>
        </>
      )}
    </p>
  );
}
