import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Test } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const STATUS_BADGE: Record<
  Test["status"],
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  in_progress: { label: "In progress", variant: "secondary" },
  submitted: { label: "Completed", variant: "default" },
  abandoned: { label: "Abandoned", variant: "outline" },
};

/**
 * Full-history table. A past-deadline test can still read `in_progress`
 * here — it displays as stored, and opening it runs finalizeIfExpired on
 * the take/results pages, which fixes the row (existing behavior).
 */
export function HistoryTable({ tests }: { tests: Test[] }) {
  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Questions</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tests.map((test) => {
              const inProgress = test.status === "in_progress";
              const score =
                test.score == null ? null : Math.round(Number(test.score));
              const badge = STATUS_BADGE[test.status];

              return (
                <TableRow key={test.id}>
                  <TableCell className="whitespace-nowrap">
                    {dateFormatter.format(new Date(test.started_at))}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {test.total_questions}
                  </TableCell>
                  <TableCell>
                    {score == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={cn(
                          "font-semibold tabular-nums",
                          score >= 50 ? "text-foreground" : "text-destructive"
                        )}
                      >
                        {score}%
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link
                        href={
                          inProgress
                            ? `/tests/${test.id}/take`
                            : `/tests/${test.id}/results`
                        }
                      >
                        {inProgress ? "Resume" : "View"}
                        <ArrowRight data-icon="inline-end" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
