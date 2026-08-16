import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  Download,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  getOrgReadinessDashboard,
  listAssignmentProgress,
  listOrgDepartments,
  listOrgEntitledExams,
  requireOrgAdmin,
  type OrgMemberStats,
} from "@/lib/orgs";
import { departmentSummaries, orgHeadline } from "@/lib/orgs-core";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatCard } from "@/components/dashboard/stat-card";
import { TrendSparkline } from "@/components/org/trend-sparkline";
import {
  ReadinessCell,
  ReasonChips,
} from "@/components/org/readiness-badges";

export const metadata: Metadata = { title: "Organisation dashboard" };

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : undefined;
}

/** The filter's "no department" sentinel — can't collide with a uuid. */
const UNASSIGNED = "unassigned";

const SORTS = ["score", "name", "lastActive"] as const;
type SortKey = (typeof SORTS)[number];

/** Nulls (insufficient data) sort to the end whichever way the column goes. */
function sortRows(
  rows: OrgMemberStats[],
  sort: SortKey,
  desc: boolean
): OrgMemberStats[] {
  const sorted = [...rows].sort((a, b) => {
    if (sort === "name") {
      return (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "");
    }
    if (sort === "lastActive") {
      return (a.lastActiveDay ?? "").localeCompare(b.lastActiveDay ?? "");
    }
    const as = a.readiness.score;
    const bs = b.readiness.score;
    if (as === null || bs === null) {
      return Number(as === null) - Number(bs === null);
    }
    return as - bs;
  });
  if (!desc) return sorted;
  // Keep null scores trailing even when descending.
  if (sort === "score") {
    const scored = sorted.filter((r) => r.readiness.score !== null).reverse();
    const unscored = sorted.filter((r) => r.readiness.score === null);
    return [...scored, ...unscored];
  }
  return sorted.reverse();
}

/**
 * The program-director view (SPEC §8 v2): per-member exam readiness —
 * aggregates and bands, never individual answers. That boundary is enforced
 * in lib/orgs.ts, which has no path into review data.
 */
export default async function OrgDashboardPage(props: PageProps<"/org">) {
  const session = await requireOrgAdmin();
  const sp = await props.searchParams;
  const now = new Date();

  const exams = await listOrgEntitledExams(session.org, now);
  if (exams.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="font-display text-lg">No examinations to measure yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Readiness tracks your members against an exam your organisation
            holds — add one from the Billing tab.
          </p>
        </CardContent>
      </Card>
    );
  }

  const requestedExam = one(sp.exam);
  const examId = exams.some((e) => e.id === requestedExam)
    ? requestedExam!
    : exams[0].id;
  const exam = exams.find((e) => e.id === examId)!;

  const [dashboard, progress, departments] = await Promise.all([
    getOrgReadinessDashboard(session.org, examId, now),
    listAssignmentProgress(session.org.id),
    listOrgDepartments(session.org.id),
  ]);

  // The strip always aggregates ALL rows; the ?department= filter narrows
  // the member table and recomputes the headline cards for that slice.
  const summaries = departmentSummaries(departments, dashboard.members);
  const requestedDept = one(sp.department);
  const filter =
    requestedDept === UNASSIGNED
      ? UNASSIGNED
      : departments.some((d) => d.id === requestedDept)
        ? requestedDept
        : undefined;
  const atRiskOnly = one(sp.band) === "at_risk";
  const sort: SortKey = SORTS.includes(one(sp.sort) as SortKey)
    ? (one(sp.sort) as SortKey)
    : "score";
  const desc = one(sp.dir) === "desc";

  const inDepartment = (row: OrgMemberStats) =>
    filter === undefined ||
    (filter === UNASSIGNED
      ? row.member.department_id === null
      : row.member.department_id === filter);

  const deptRows = dashboard.members.filter(inDepartment);
  const rows = sortRows(
    atRiskOnly
      ? deptRows.filter((r) => r.readiness.band === "at_risk")
      : deptRows,
    sort,
    desc
  );
  const headline =
    filter === undefined ? dashboard.headline : orgHeadline(deptRows, now);
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));

  /** Rebuild the query string with one key changed, dropping defaults. */
  const href = (over: Partial<Record<string, string | undefined>>) => {
    const params = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      exam: examId === exams[0].id ? undefined : examId,
      department: filter,
      band: atRiskOnly ? "at_risk" : undefined,
      sort: sort === "score" ? undefined : sort,
      dir: desc ? "desc" : undefined,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined) params.set(k, v);
    }
    const qs = params.toString();
    return qs === "" ? "/org" : `/org?${qs}`;
  };
  /** Header link: click to sort; click again to flip direction. */
  const sortHref = (key: SortKey) =>
    href({ sort: key, dir: sort === key && !desc ? "desc" : undefined });

  const csvQuery = new URLSearchParams({ exam: examId });
  if (filter !== undefined) csvQuery.set("department", filter);

  return (
    <div className="space-y-6">
      {exams.length > 1 && (
        <nav aria-label="Choose an examination" className="flex flex-wrap gap-2">
          {exams.map((e) => (
            <Link
              key={e.id}
              href={href({ exam: e.id === exams[0].id ? undefined : e.id })}
              className={cn(
                "rounded-xl border px-3 py-2 text-sm",
                e.id === examId
                  ? "border-primary bg-primary/5 font-medium"
                  : "border-border hover:bg-muted"
              )}
            >
              {e.name}
              {e.sittingOn && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {shortDate(`${e.sittingOn}T00:00:00Z`)}
                </span>
              )}
            </Link>
          ))}
        </nav>
      )}

      {dashboard.sitting && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarClock className="size-4" aria-hidden="true" />
          {dashboard.sitting.kind === "upcoming"
            ? dashboard.sitting.daysRemaining === 0
              ? `${exam.name} sitting is today.`
              : `${dashboard.sitting.daysRemaining} days until the ${exam.name} sitting.`
            : `The ${exam.name} sitting date has passed.`}
        </p>
      )}

      {departments.length > 0 && (
        <nav aria-label="Filter by department" className="flex flex-wrap gap-2">
          <Link
            href={href({ department: undefined })}
            className={cn(
              "rounded-xl border px-3 py-2 text-sm",
              filter === undefined
                ? "border-primary bg-primary/5 font-medium"
                : "border-border hover:bg-muted"
            )}
          >
            All
            <span className="ml-1.5 text-xs text-muted-foreground">
              {dashboard.members.length}
            </span>
          </Link>
          {summaries.map((summary) => {
            const key = summary.id ?? UNASSIGNED;
            return (
              <Link
                key={key}
                href={href({ department: key })}
                className={cn(
                  "rounded-xl border px-3 py-2 text-sm",
                  filter === key
                    ? "border-primary bg-primary/5 font-medium"
                    : "border-border hover:bg-muted"
                )}
              >
                {summary.name}
                <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                  {summary.members}
                  {summary.avgReadiness !== null &&
                    ` · ${summary.avgReadiness} avg`}
                  {summary.bands.at_risk > 0 && (
                    <span className="text-destructive">
                      {" "}
                      · {summary.bands.at_risk} at risk
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
        </nav>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Users} label="Members" value={headline.members} />
        <StatCard
          icon={TrendingUp}
          label="Average readiness"
          tone="teal"
          value={headline.avgReadiness ?? "—"}
          hint={
            headline.averageAccuracy !== null
              ? `Accuracy ${headline.averageAccuracy}% · pass mark ${session.org.pass_mark_pct}%`
              : `Pass mark ${session.org.pass_mark_pct}%`
          }
        />
        <StatCard
          icon={Target}
          label="Active this week"
          tone="teal"
          value={headline.activeThisWeek}
        />
        <StatCard
          icon={AlertTriangle}
          label="At risk"
          value={headline.atRisk}
          hint={
            dashboard.sitting?.kind === "upcoming"
              ? `${dashboard.sitting.daysRemaining} days to the sitting`
              : headline.atRisk > 0
                ? "In the at-risk readiness band"
                : "Nobody flagged"
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Members — {exam.name}</CardTitle>
          <CardDescription>
            Readiness blends recent accuracy (timed work weighted double),
            trend, subject coverage and study cadence over the last 8 weeks.
            You see aggregates — never individual answers, notes or bookmarks.
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Link
              href={href({ band: atRiskOnly ? undefined : "at_risk" })}
              aria-pressed={atRiskOnly}
              className={cn(
                "min-h-8 rounded-full border px-3 py-1.5 text-xs font-medium",
                atRiskOnly
                  ? "border-destructive bg-destructive/10 text-destructive"
                  : "border-border text-muted-foreground hover:border-destructive/50"
              )}
            >
              At risk only
            </Link>
            <Button variant="outline" size="sm" asChild className="ml-auto">
              <a href={`/api/org/readiness?${csvQuery.toString()}`} download>
                <Download data-icon="inline-start" />
                Export CSV
              </a>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Link href={sortHref("name")} className="hover:underline">
                      Member
                    </Link>
                  </TableHead>
                  {departments.length > 0 && <TableHead>Department</TableHead>}
                  <TableHead>
                    <Link href={sortHref("score")} className="hover:underline">
                      Readiness
                    </Link>
                  </TableHead>
                  <TableHead>Why</TableHead>
                  <TableHead>Trend</TableHead>
                  <TableHead>Accuracy</TableHead>
                  <TableHead>
                    <Link
                      href={sortHref("lastActive")}
                      className="hover:underline"
                    >
                      Last active
                    </Link>
                  </TableHead>
                  <TableHead>Assignments</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.member.user_id}>
                    <TableCell>
                      <Link
                        href={`/org/members/${row.member.user_id}?exam=${examId}`}
                        className="block hover:underline"
                      >
                        <span className="block font-medium">
                          {row.name ?? "—"}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {row.email ?? ""}
                        </span>
                      </Link>
                    </TableCell>
                    {departments.length > 0 && (
                      <TableCell className="text-muted-foreground">
                        {row.member.department_id
                          ? (departmentName.get(row.member.department_id) ??
                            "—")
                          : "—"}
                      </TableCell>
                    )}
                    <TableCell>
                      <ReadinessCell readiness={row.readiness} />
                    </TableCell>
                    <TableCell>
                      <ReasonChips reasons={row.readiness.reasons} />
                    </TableCell>
                    <TableCell>
                      <TrendSparkline series={row.readiness.weeklyAccuracy} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.readiness.accuracyPct !== null
                        ? `${row.readiness.accuracyPct}%`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.lastActiveDay
                        ? shortDate(`${row.lastActiveDay}T00:00:00Z`)
                        : "Never"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.assignmentsCompleted}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={departments.length > 0 ? 8 : 7}
                      className="text-muted-foreground"
                    >
                      {atRiskOnly
                        ? "Nobody sits in the at-risk band here."
                        : filter === undefined
                          ? "No members yet — invite people from the Members tab."
                          : "Nobody here — assign members from the Members tab."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {progress.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Assignment completion</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {progress.map(
                ({ assignment, targeted, completed, late, departmentName: deptName }) => (
                  <li
                    key={assignment.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {assignment.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {assignment.audience === "department" &&
                        deptName !== null &&
                        `${deptName} · `}
                      due {shortDate(assignment.due_at)}
                    </span>
                    {assignment.audience === "department" &&
                    deptName === null ? (
                      <Badge variant="destructive">Department deleted</Badge>
                    ) : (
                      <Badge
                        variant={
                          completed >= targeted && targeted > 0
                            ? "default"
                            : "secondary"
                        }
                      >
                        {completed}/{targeted}
                        {late > 0 ? ` · ${late} late` : ""}
                      </Badge>
                    )}
                  </li>
                )
              )}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
