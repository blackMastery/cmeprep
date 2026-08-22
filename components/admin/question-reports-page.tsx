import Link from "next/link";
import { ArrowLeft, Flag } from "lucide-react";
import type { ContentScope } from "@/lib/admin/content-scope";
import { listReportRollups } from "@/lib/admin/question-reports";
import { REPORT_RATE_FLOOR } from "@/lib/question-reports-core";
import { Button } from "@/components/ui/button";
import { QuestionReportsQueue } from "@/components/admin/question-reports-queue";
import { ReportsViewTabs } from "@/components/admin/reports-view-tabs";

/**
 * The question-reports queue, shared by /admin/questions/reports (platform
 * scope) and /org/content/reports (org scope). The scope is the ONLY thing
 * that differs in what is read; the chrome differs in hrefs and copy.
 */
export async function QuestionReportsPage({
  scope,
  view,
  basePath,
  editorBasePath,
  backHref,
  heading,
  ownerCopy,
}: {
  scope: ContentScope;
  view: "open" | "resolved";
  basePath: string;
  editorBasePath: string;
  backHref: string;
  /** Rendered as h1 on /admin, h2 inside the org layout. */
  heading: "h1" | "h2";
  /** "" for the platform, "by your members" for an org. */
  ownerCopy: string;
}) {
  const rollups = await listReportRollups(scope, view);
  const Heading = heading;
  const n = rollups.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={backHref}>
            <ArrowLeft data-icon="inline-start" />
            Questions
          </Link>
        </Button>
        <Heading className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Question reports
        </Heading>
      </div>
      <p className="text-sm text-muted-foreground sm:text-base">
        {view === "open"
          ? n === 0
            ? `Nothing reported${ownerCopy ? ` ${ownerCopy}` : ""}.`
            : `${n} question${n === 1 ? "" : "s"} reported${ownerCopy ? ` ${ownerCopy}` : ""}.`
          : "Past rulings. A resolved question that gets reported again reopens carrying its last ruling."}{" "}
        Ranked by reporters ÷ attempts once a question has {REPORT_RATE_FLOOR}{" "}
        reporters; by reporter count below that.
      </p>

      <ReportsViewTabs basePath={basePath} view={view} />

      <QuestionReportsQueue
        rollups={rollups}
        view={view}
        editorBasePath={editorBasePath}
      />
    </div>
  );
}

/** The "Reports" button with the open-question count, for surfaces that
 * have no sidebar badge (the org content pages). */
export function ReportsLink({ href, count }: { href: string; count: number }) {
  return (
    <Button variant="outline" asChild>
      <Link href={href}>
        <Flag data-icon="inline-start" />
        Reports
        {count > 0 && (
          <span
            className="ml-1 rounded-full bg-destructive px-1.5 text-xs font-semibold text-white tabular-nums"
            aria-label={`${count} needing attention`}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
    </Button>
  );
}
