import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * An exam the student's subscription doesn't cover.
 *
 * Shown rather than hidden so the catalogue stays discoverable and the upsell
 * lands where the intent is. A plain div, not a button: the only tab stop is
 * "Get access", so keyboard focus never rests on something unselectable.
 */
export function LockedExamRow({
  name,
  subjectCount,
  href,
}: {
  name: string;
  subjectCount: number;
  /** Still accepted (callers pass it) but no longer rendered — see below. */
  questionCount: number;
  /** null when nothing is purchasable — the row then just explains itself. */
  href: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3.5">
      <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <p className="font-medium text-muted-foreground wrap-break-word">
          {name}
        </p>
        <p className="text-xs text-muted-foreground">
          {subjectCount} subject{subjectCount === 1 ? "" : "s"}
          {/* Bank size is deliberately hidden from students. To restore,
              destructure `questionCount` again and uncomment:
          {" "}· {questionCount.toLocaleString()} question
          {questionCount === 1 ? "" : "s"} */}
          <span className="sr-only"> — not included in your subscription</span>
        </p>
      </div>

      {href && (
        <Button variant="outline" size="sm" asChild>
          <Link href={href}>
            Get access
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      )}
    </div>
  );
}
