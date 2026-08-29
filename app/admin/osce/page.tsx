import type { Metadata } from "next";
import Link from "next/link";
import { Flag } from "lucide-react";
import {
  listGradingEvents,
  osceDaySummary,
  OSCE_EVENTS_PAGE_SIZE,
} from "@/lib/admin/osce";
import { OSCE_DAILY_CAP } from "@/lib/osce-grading-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SummaryTile } from "@/components/admin/summary-tile";

export const metadata: Metadata = { title: "OSCE grading" };

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : undefined;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * The OSCE grading log: every OpenAI judge call, successes and failures, with
 * token spend. This is where "why was this marked wrong?" and "what is
 * grading costing us?" get answered — the raw model output lives only in
 * the underlying table.
 */
export default async function AdminOscePage(props: PageProps<"/admin/osce">) {
  const sp = await props.searchParams;
  const page = Number(one(sp.page) ?? 1) || 1;

  const [events, today] = await Promise.all([
    listGradingEvents(page),
    osceDaySummary(),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            OSCE grading
          </h1>
          <p className="mt-1 text-muted-foreground">
            Every AI grading call, newest first. Users are capped at{" "}
            {OSCE_DAILY_CAP} graded stations per day.
          </p>
        </div>
        <Button variant="outline-muted" asChild>
          <Link href="/admin/osce/reports">
            <Flag data-icon="inline-start" />
            Grade reports
          </Link>
        </Button>
      </header>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <SummaryTile label="Graded today" value={String(today.gradedToday)} />
        <SummaryTile
          label="Failed calls today"
          value={String(today.failedToday)}
          warn={today.failedToday > 0}
        />
        <SummaryTile
          label="Tokens today"
          value={today.tokensToday.toLocaleString()}
        />
      </div>

      {events.rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-display text-lg">No grading calls yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Calls appear here the moment a student checks an OSCE answer.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {events.rows.map((row) => (
            <li key={row.id}>
              <Card className="[--card-spacing:--spacing(4)]">
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {row.verdict === null ? (
                      <Badge variant="destructive">Failed</Badge>
                    ) : (
                      <Badge
                        variant={
                          row.verdict === "correct" ? "default" : "secondary"
                        }
                      >
                        {row.verdict}
                      </Badge>
                    )}
                    <span className="font-medium">{row.userName}</span>
                    <span className="text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString("en-GB")}
                    </span>
                    <span className="ml-auto text-muted-foreground tabular-nums">
                      {row.model} ·{" "}
                      {(
                        (row.promptTokens ?? 0) + (row.completionTokens ?? 0)
                      ).toLocaleString()}{" "}
                      tok · {(row.durationMs / 1000).toFixed(1)}s
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {truncate(row.questionStem, 160)}
                  </p>
                  <p className="text-sm">
                    <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      Answer:{" "}
                    </span>
                    {truncate(row.answerText, 240)}
                  </p>
                  {row.error && (
                    <p className="text-xs text-destructive">{row.error}</p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {events.pageCount > 1 && (
        <nav
          className="mt-6 flex items-center justify-between gap-2"
          aria-label="Pagination"
        >
          <Button
            variant="outline-muted"
            size="sm"
            disabled={events.page <= 1}
            asChild={events.page > 1}
          >
            {events.page > 1 ? (
              <Link href={`/admin/osce?page=${events.page - 1}`}>Previous</Link>
            ) : (
              <span>Previous</span>
            )}
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {(events.page - 1) * OSCE_EVENTS_PAGE_SIZE + 1}–
            {Math.min(events.page * OSCE_EVENTS_PAGE_SIZE, events.total)} of{" "}
            {events.total}
          </span>
          <Button
            variant="outline-muted"
            size="sm"
            disabled={events.page >= events.pageCount}
            asChild={events.page < events.pageCount}
          >
            {events.page < events.pageCount ? (
              <Link href={`/admin/osce?page=${events.page + 1}`}>Next</Link>
            ) : (
              <span>Next</span>
            )}
          </Button>
        </nav>
      )}
    </div>
  );
}

