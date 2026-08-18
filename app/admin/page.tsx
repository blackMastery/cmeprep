import Link from "next/link";
import {
  BookOpen,
  CreditCard,
  FileText,
  FolderTree,
  GraduationCap,
  ListChecks,
  Mail,
  Plus,
  Users,
} from "lucide-react";
import {
  getContentQualitySection,
  getEngagementSection,
  getOpsHealth,
  getRevenueSection,
  getTodayLive,
  listExamOptions,
} from "@/lib/analytics";
import { DEFAULT_RANGE, RANGE_PRESETS, type RangePreset } from "@/lib/analytics-core";
import { contentCounts } from "@/lib/admin/questions";
import { unhandledMessageCount } from "@/lib/admin/messages";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OpsAlerts } from "@/components/admin/analytics/ops-alerts";
import { RevenueSection } from "@/components/admin/analytics/revenue-section";
import { EngagementSection } from "@/components/admin/analytics/engagement-section";
import { ContentQualitySection } from "@/components/admin/analytics/content-quality-section";

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : undefined;
}

const RANGE_LABEL: Record<RangePreset, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "12mo": "12 months",
  all: "All time",
};

/**
 * The business dashboard — what an admin sees first. Trend charts and tables
 * read the nightly rollup tables (lib/analytics.ts); the "today" cards are
 * live one-day queries; ops alerts render only when something is wrong.
 * Filters travel as searchParams (org readiness page pattern) so the whole
 * page stays a Server Component.
 */
export default async function AdminOverviewPage(props: PageProps<"/admin">) {
  const sp = await props.searchParams;

  const rawRange = one(sp.range);
  const range: RangePreset = RANGE_PRESETS.includes(rawRange as RangePreset)
    ? (rawRange as RangePreset)
    : DEFAULT_RANGE;

  const exams = await listExamOptions();
  const requestedExam = one(sp.exam);
  const examId = exams.some((e) => e.id === requestedExam)
    ? requestedExam!
    : null;

  const [revenue, engagement, quality, ops, today, counts, openMessages] =
    await Promise.all([
      getRevenueSection(range, examId),
      getEngagementSection(range, examId),
      getContentQualitySection(examId),
      getOpsHealth(),
      getTodayLive(),
      contentCounts(),
      unhandledMessageCount(),
    ]);

  /** Rebuild the query string with one key changed, dropping defaults. */
  const href = (over: { range?: RangePreset; exam?: string | null }) => {
    const params = new URLSearchParams();
    const nextRange = over.range ?? range;
    const nextExam = over.exam === undefined ? examId : over.exam;
    if (nextRange !== DEFAULT_RANGE) params.set("range", nextRange);
    if (nextExam !== null) params.set("exam", nextExam);
    const qs = params.toString();
    return qs === "" ? "/admin" : `/admin?${qs}`;
  };

  const csvQuery = new URLSearchParams({ range });
  if (examId !== null) csvQuery.set("exam", examId);

  const contentStats = [
    { icon: ListChecks, label: "Published", value: counts.published, href: "/admin/questions" },
    { icon: FileText, label: "Drafts", value: counts.drafts, href: "/admin/questions?status=draft" },
    { icon: GraduationCap, label: "Exams", value: counts.exams, href: "/admin/exams" },
    { icon: FolderTree, label: "Subjects", value: counts.subjects, href: "/admin/subjects" },
    { icon: Users, label: "Users", value: counts.users, href: "/admin/users" },
    { icon: CreditCard, label: "Plans", value: counts.plans, href: "/admin/plans" },
    { icon: Mail, label: "Open messages", value: openMessages, href: "/admin/messages" },
    { icon: BookOpen, label: "CME courses", value: null, href: "/admin/courses" },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Overview
          </h1>
          <p className="mt-1 text-muted-foreground">
            Revenue, engagement and question-bank health. Trends update
            nightly; today&apos;s cards are live.
          </p>
        </div>
        <Button size="lg" asChild>
          <Link href="/admin/questions/new">
            <Plus data-icon="inline-start" />
            New question
          </Link>
        </Button>
      </header>

      <OpsAlerts ops={ops} />

      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Time range" className="flex flex-wrap gap-2">
          {RANGE_PRESETS.map((preset) => (
            <Link
              key={preset}
              href={href({ range: preset })}
              aria-current={preset === range ? "true" : undefined}
              className={cn(
                "rounded-xl border px-3 py-2 text-sm",
                preset === range
                  ? "border-primary bg-primary/5 font-medium"
                  : "border-border hover:bg-muted"
              )}
            >
              {RANGE_LABEL[preset]}
            </Link>
          ))}
        </nav>

        {exams.length > 0 && (
          <nav aria-label="Filter by exam" className="ml-auto flex flex-wrap gap-2">
            <Link
              href={href({ exam: null })}
              className={cn(
                "rounded-xl border px-3 py-2 text-sm",
                examId === null
                  ? "border-primary bg-primary/5 font-medium"
                  : "border-border hover:bg-muted"
              )}
            >
              All exams
            </Link>
            {exams.map((e) => (
              <Link
                key={e.id}
                href={href({ exam: e.id })}
                className={cn(
                  "rounded-xl border px-3 py-2 text-sm",
                  examId === e.id
                    ? "border-primary bg-primary/5 font-medium"
                    : "border-border hover:bg-muted"
                )}
              >
                {e.name}
              </Link>
            ))}
          </nav>
        )}
      </div>

      <RevenueSection
        data={revenue}
        today={today}
        csvHref={`/api/admin/revenue?${csvQuery.toString()}`}
      />

      <EngagementSection data={engagement} today={today} />

      <ContentQualitySection data={quality} />

      <section aria-labelledby="content-heading" className="space-y-4">
        <h2 id="content-heading" className="font-display text-xl font-semibold">
          Content
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {contentStats.map((stat) => (
            <Link
              key={stat.label}
              href={stat.href}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:bg-muted"
            >
              <stat.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate text-sm text-muted-foreground">
                  {stat.label}
                </span>
                {stat.value !== null && (
                  <span className="block font-display text-lg font-semibold tabular-nums">
                    {stat.value}
                  </span>
                )}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
