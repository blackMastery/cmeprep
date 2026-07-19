import Link from "next/link";
import { ArrowRight, ClipboardList } from "lucide-react";
import type { Test } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
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

export function PastTests({ tests }: { tests: Test[] }) {
  if (tests.length === 0) {
    return (
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-accent text-primary">
            <ClipboardList className="size-6" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-display text-lg">No tests yet</h2>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Your first mock exam is a few clicks away. Pick a subject and
              we&apos;ll build it for you.
            </p>
          </div>
          <Button asChild>
            <Link href="/tests/new">Start your first test</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <h2 className="font-display text-lg">Past tests</h2>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Questions</TableHead>
              <TableHead>Score</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tests.map((test) => {
              const inProgress = test.status === "in_progress";
              const score = test.score == null ? null : Math.round(Number(test.score));

              return (
                <TableRow key={test.id}>
                  <TableCell className="whitespace-nowrap">
                    {dateFormatter.format(new Date(test.started_at))}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {test.total_questions}
                  </TableCell>
                  <TableCell>
                    {inProgress ? (
                      <span className="text-xs font-medium text-muted-foreground">
                        In progress
                      </span>
                    ) : (
                      <span
                        className={cn(
                          "font-semibold tabular-nums",
                          score != null && score >= 50
                            ? "text-foreground"
                            : "text-destructive"
                        )}
                      >
                        {score ?? "—"}%
                      </span>
                    )}
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
