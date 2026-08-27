import type { Metadata } from "next";
import Link from "next/link";
import { Coins, MessagesSquare, MessageCircleQuestion, Receipt, Zap } from "lucide-react";
import { getTutorUsage } from "@/lib/admin/tutor-usage";
import {
  DEFAULT_RANGE,
  RANGE_PRESETS,
  type RangePreset,
} from "@/lib/analytics-core";
import { TUTOR_DAILY_CAP } from "@/lib/tutor-core";
import {
  compactTokens,
  costLabel,
  daySpan,
  MODEL_RATES,
  RATES_AS_OF,
  TUTOR_USAGE_TOP_USERS,
} from "@/lib/tutor-usage-core";
import { cn } from "@/lib/utils";
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
import { DailyChart } from "@/components/admin/analytics/daily-chart";

export const metadata: Metadata = { title: "Tutor usage" };

const RANGE_LABEL: Record<RangePreset, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "12mo": "12 months",
  all: "All time",
};

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : undefined;
}

const num = (n: number): string => n.toLocaleString("en-GB");

const when = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Guyana",
});

/**
 * What the AI tutor is costing: tokens per day, per student and per model,
 * with a USD estimate. The message-count cap (TUTOR_DAILY_CAP) is the live
 * limiter; this page is the evidence for tuning it, or for a token-based cap
 * later. Range travels as a searchParam (overview-page pattern) so the whole
 * page stays a Server Component.
 */
export default async function AdminTutorUsagePage(props: PageProps<"/admin/tutor">) {
  const sp = await props.searchParams;
  const rawRange = one(sp.range);
  const range: RangePreset = RANGE_PRESETS.includes(rawRange as RangePreset)
    ? (rawRange as RangePreset)
    : DEFAULT_RANGE;

  const usage = await getTutorUsage(range);
  const { totals, todayTotals } = usage;
  const empty = totals.questions === 0 && totals.answers === 0;

  const href = (preset: RangePreset) =>
    preset === DEFAULT_RANGE ? "/admin/tutor" : `/admin/tutor?range=${preset}`;

  const rateNote = Object.entries(MODEL_RATES)
    .map(([m, r]) => `${m.split("/")[1]} $${r.inputPerM}/$${r.outputPerM} per 1M`)
    .join(" · ");

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:py-12">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Tutor usage
          </h1>
          <p className="mt-1 text-muted-foreground">
            Model spend on the AI tutor. Students are capped at{" "}
            {TUTOR_DAILY_CAP} questions per day; the numbers here are what that
            cap is costing.
          </p>
        </div>
        <Button variant="outline-muted" asChild>
          <Link href="/admin/tutor/feedback">
            <MessagesSquare data-icon="inline-start" />
            Feedback
          </Link>
        </Button>
      </header>

      <nav aria-label="Time range" className="flex flex-wrap gap-2">
        {RANGE_PRESETS.map((preset) => (
          <Link
            key={preset}
            href={href(preset)}
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Zap}
          label="Tokens today"
          tone="teal"
          value={compactTokens(todayTotals.totalTokens)}
          hint={`${num(todayTotals.questions)} questions · ${num(todayTotals.failed)} failed · live`}
        />
        <StatCard
          icon={Coins}
          label="Tokens in range"
          value={compactTokens(totals.totalTokens)}
          hint={`${compactTokens(totals.promptTokens)} prompt · ${compactTokens(totals.completionTokens)} completion`}
        />
        <StatCard
          icon={MessageCircleQuestion}
          label="Answers in range"
          value={num(totals.answers)}
          hint={
            totals.avgTokensPerAnswer === null
              ? `${num(totals.unmeasured)} not measured`
              : `~${num(totals.avgTokensPerAnswer)} tokens each · ${num(totals.unmeasured)} not measured`
          }
        />
        <StatCard
          icon={Receipt}
          label="Est. cost in range"
          value={costLabel(totals.estCostUsd)}
          hint={
            totals.unpricedTokens > 0
              ? `${compactTokens(totals.unpricedTokens)} tokens on unpriced models`
              : `${rateNote} · as of ${RATES_AS_OF}`
          }
        />
      </div>

      {empty ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-display text-lg">No tutor messages in this range.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Usage appears here the moment a student asks the tutor a question.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Tokens per day</CardTitle>
              <CardDescription>
                Prompt tokens are the retrieved passages plus conversation
                history; completion tokens are the answer itself. Refusals
                and disconnected answers carry no usage and are not counted
                — &ldquo;not measured&rdquo; above is how many.{" "}
                {daySpan(usage.from, usage.to)} days, Guyana time.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DailyChart
                kind="line"
                ariaLabel="Tutor prompt and completion tokens per day"
                formatValue={compactTokens}
                series={[
                  { label: "Prompt", tone: "teal", points: usage.dayPoints.prompt },
                  { label: "Completion", tone: "crimson", points: usage.dayPoints.completion },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top students by tokens</CardTitle>
              <CardDescription>
                Up to {TUTOR_USAGE_TOP_USERS} heaviest users in range. Share is
                of all tokens in range, so it still reads correctly when the
                list is capped.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead className="text-right">Questions</TableHead>
                      <TableHead className="text-right">Answers</TableHead>
                      <TableHead className="text-right">Prompt</TableHead>
                      <TableHead className="text-right">Completion</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                      <TableHead className="text-right">Est. cost</TableHead>
                      <TableHead className="text-right">Last active</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usage.users.map((u) => (
                      <TableRow key={u.userId}>
                        <TableCell>
                          <Link
                            href={`/admin/users/${u.userId}`}
                            className="font-medium hover:underline"
                          >
                            {u.name}
                          </Link>
                          {u.email && (
                            <span className="block text-xs text-muted-foreground">
                              {u.email}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{num(u.questions)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {num(u.answers)}
                          {u.answers > u.measured && (
                            <span
                              className="text-muted-foreground"
                              title={`${u.answers - u.measured} not measured`}
                            >
                              {" "}
                              ({u.answers - u.measured})
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{num(u.promptTokens)}</TableCell>
                        <TableCell className="text-right tabular-nums">{num(u.completionTokens)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{num(u.totalTokens)}</TableCell>
                        <TableCell className="text-right tabular-nums">{u.sharePct}%</TableCell>
                        <TableCell className="text-right tabular-nums">{costLabel(u.estCostUsd)}</TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums whitespace-nowrap">
                          {when.format(new Date(u.lastAt))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>By model</CardTitle>
              <CardDescription>
                The tutor records which model answered, so a model or tier
                change shows up here as a second row rather than a blended
                average. The blank model is refusals — no model was called.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Model</TableHead>
                      <TableHead className="text-right">Answers</TableHead>
                      <TableHead className="text-right">Measured</TableHead>
                      <TableHead className="text-right">Prompt</TableHead>
                      <TableHead className="text-right">Completion</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Est. cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usage.models.map((m) => (
                      <TableRow key={m.model ?? "none"}>
                        <TableCell className="font-medium">
                          {m.model ?? (
                            <span className="text-muted-foreground">refusals</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{num(m.answers)}</TableCell>
                        <TableCell className="text-right tabular-nums">{num(m.measured)}</TableCell>
                        <TableCell className="text-right tabular-nums">{num(m.promptTokens)}</TableCell>
                        <TableCell className="text-right tabular-nums">{num(m.completionTokens)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{num(m.totalTokens)}</TableCell>
                        <TableCell className="text-right tabular-nums">{costLabel(m.estCostUsd)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
