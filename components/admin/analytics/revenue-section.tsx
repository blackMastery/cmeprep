import Link from "next/link";
import { Banknote, Download, Receipt, RotateCcw } from "lucide-react";
import type { RevenueSection as RevenueData, TodayLive } from "@/lib/analytics";
import type { BreakdownRow } from "@/lib/analytics";
import { priceLabel } from "@/lib/format";
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

/** Signed cents → "$25" / "-$3.50", with a suffix for anything non-USD. */
function money(cents: number, currency: string): string {
  const label = `${cents < 0 ? "-" : ""}${priceLabel(Math.abs(cents))}`;
  return currency === "USD" ? label : `${label} ${currency}`;
}

function BreakdownTable({
  caption,
  keyHeader,
  rows,
  hrefFor,
}: {
  caption: string;
  keyHeader: string;
  rows: BreakdownRow[];
  hrefFor?: (row: BreakdownRow) => string | null;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{keyHeader}</TableHead>
            <TableHead className="text-right">Payments</TableHead>
            <TableHead className="text-right">Gross</TableHead>
            <TableHead className="text-right">Refunded</TableHead>
            <TableHead className="text-right">Net</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const href = hrefFor?.(row) ?? null;
            return (
              <TableRow key={`${row.key} ${row.currency}`}>
                <TableCell className="font-medium">
                  {href ? (
                    <Link href={href} className="hover:underline">
                      {row.label}
                    </Link>
                  ) : (
                    row.label
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.paymentsCount}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(row.grossCents, row.currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {row.refundCents > 0 ? money(row.refundCents, row.currency) : "—"}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {money(row.netCents, row.currency)}
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground">
                Nothing in this range.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <p className="sr-only">{caption}</p>
    </div>
  );
}

/**
 * Money, net of refunds ON THE DAY THEY WERE OBSERVED — past days never
 * restate. "Today" cards are live raw-table reads; every chart and table
 * reads the nightly rollups, so today itself joins the chart tomorrow.
 */
export function RevenueSection({
  data,
  today,
  csvHref,
}: {
  data: RevenueData;
  today: TodayLive;
  csvHref: string;
}) {
  const usd = data.totals.find((t) => t.currency === data.chartCurrency);
  const todayRevenue = today.revenue[0] ?? null;

  return (
    <section aria-labelledby="revenue-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="revenue-heading" className="font-display text-xl font-semibold">
          Revenue
        </h2>
        <Button variant="outline" size="sm" asChild>
          <a href={csvHref} download>
            <Download data-icon="inline-start" />
            Export CSV
          </a>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Banknote}
          label="Net today"
          tone="teal"
          value={todayRevenue ? money(todayRevenue.netCents, todayRevenue.currency) : "$0"}
          hint={`${today.testsSubmitted} tests submitted · live`}
        />
        <StatCard
          icon={Receipt}
          label="Payments today"
          value={todayRevenue?.paymentsCount ?? 0}
          hint="Captured since midnight (Guyana) · live"
        />
        <StatCard
          icon={Banknote}
          label="Net in range"
          tone="teal"
          value={usd ? money(usd.netCents, usd.currency) : "—"}
          hint={usd ? `Gross ${money(usd.grossCents, usd.currency)}` : undefined}
        />
        <StatCard
          icon={RotateCcw}
          label="Refunded in range"
          value={usd ? money(usd.refundCents, usd.currency) : "—"}
          hint="Booked on the day observed"
        />
      </div>

      {data.totals.length > 1 && (
        <p className="text-sm text-muted-foreground">
          Other currencies in this range:{" "}
          {data.totals
            .slice(1)
            .map((t) => `${money(t.netCents, t.currency)} net`)
            .join(", ")}
          . Currencies are never summed together.
        </p>
      )}
      {usd !== undefined && usd.nullAmounts > 0 && (
        <p className="text-sm text-destructive">
          {usd.nullAmounts} capture{usd.nullAmounts === 1 ? "" : "s"} in this
          range arrived with no amount — counted as $0.
        </p>
      )}

      {data.hasRollups ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Net revenue by day</CardTitle>
              <CardDescription>
                {data.chartCurrency ?? ""} only. Today appears after tonight&apos;s
                rollup.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DailyChart
                kind="bar"
                ariaLabel="Net revenue per day"
                series={[
                  {
                    label: "Net",
                    tone: "teal",
                    points: data.netByDay,
                  },
                ]}
                formatValue={(v) => money(v, data.chartCurrency ?? "USD")}
              />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>By exam</CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownTable
                  caption="Revenue by exam"
                  keyHeader="Exam"
                  rows={data.byExam}
                  hrefFor={(row) =>
                    row.key === "none" ? null : `/admin/payments?exam=${row.key}`
                  }
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>By plan</CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownTable
                  caption="Revenue by plan"
                  keyHeader="Plan"
                  rows={data.byPlan}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>By channel and source</CardTitle>
              <CardDescription>
                Personal vs organisation purchases, split by which code path
                recorded the capture.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BreakdownTable
                caption="Revenue by channel and payment source"
                keyHeader="Channel · source"
                rows={data.byChannelSource}
              />
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No revenue rollups yet. They build nightly — or run the backfill to
            load history (POST /api/admin/analytics/rollup with{" "}
            <code>{'{"mode":"backfill"}'}</code>).
          </CardContent>
        </Card>
      )}
    </section>
  );
}
