import { Activity, CalendarDays, ListChecks, Users } from "lucide-react";
import type { EngagementSection as EngagementData, TodayLive } from "@/lib/analytics";
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
import { DailyChart } from "@/components/admin/analytics/daily-chart";

/**
 * Study activity. "Active" = answered at least one question that Guyana day.
 * DAU/WAU/MAU and the trend read the nightly rollups (so they are platform-
 * wide regardless of the exam filter); the accuracy lines respect it.
 */
export function EngagementSection({
  data,
  today,
}: {
  data: EngagementData;
  today: TodayLive;
}) {
  const t = data.rangeTotals;

  return (
    <section aria-labelledby="engagement-heading" className="space-y-4">
      <h2 id="engagement-heading" className="font-display text-xl font-semibold">
        Engagement
      </h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Users}
          label="Active today"
          tone="teal"
          value={today.dau}
          hint={`${today.attempts} questions answered · live`}
        />
        <StatCard
          icon={CalendarDays}
          label="Weekly actives"
          value={data.latest?.wau ?? "—"}
          hint={data.latest ? `As of ${data.latest.day}` : "Awaiting first rollup"}
        />
        <StatCard
          icon={CalendarDays}
          label="Monthly actives"
          value={data.latest?.mau ?? "—"}
          hint={data.latest ? "Trailing 30 days" : "Awaiting first rollup"}
        />
        <StatCard
          icon={ListChecks}
          label="Tests started today"
          value={today.testsStarted}
          hint={`${today.testsSubmitted} submitted · live`}
        />
      </div>

      {data.hasRollups ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Daily active users</CardTitle>
              <CardDescription>
                Users who answered at least one question. Platform-wide — the
                exam filter does not narrow this chart.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DailyChart
                kind="line"
                ariaLabel="Daily active users over the selected range"
                series={[{ label: "DAU", tone: "coral", points: data.dauByDay }]}
              />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Tests in range</CardTitle>
                <CardDescription>
                  Ended = abandoned, or an exam-mode deadline that passed
                  unsubmitted.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mode</TableHead>
                        <TableHead className="text-right">Started</TableHead>
                        <TableHead className="text-right">Submitted</TableHead>
                        <TableHead className="text-right">Ended</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-medium">Exam</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {t.startedExam}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {t.submittedExam}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {t.endedExam}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">Tutor</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {t.startedTutor}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {t.submittedTutor}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {t.endedTutor}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  <Activity className="mr-1 inline size-4 align-text-bottom" aria-hidden="true" />
                  {t.attempts.toLocaleString("en-GB")} questions answered in
                  range
                  {t.attempts > 0 &&
                    ` · ${Math.round((t.correct / t.attempts) * 100)}% correct`}
                  .
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Accuracy by exam</CardTitle>
                <CardDescription>
                  Daily correct-rate across all users — a calibration signal,
                  not a pass rate. Days without attempts break the line.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DailyChart
                  kind="line"
                  ariaLabel="Platform accuracy per exam over the selected range"
                  series={data.accuracySeries.map((s) => ({
                    label: s.label,
                    points: s.points,
                  }))}
                  formatValue={(v) => `${v}%`}
                />
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No engagement rollups yet — they build nightly, or run the backfill
            to load history.
          </CardContent>
        </Card>
      )}
    </section>
  );
}
