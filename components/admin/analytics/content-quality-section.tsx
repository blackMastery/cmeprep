import Link from "next/link";
import type { ContentQualitySection as QualityData, QuestionQualityRow } from "@/lib/analytics";
import { accuracyPctOf, QUESTION_MIN_ATTEMPTS } from "@/lib/analytics-core";
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

function QuestionList({
  rows,
  showAccuracy,
}: {
  rows: QuestionQualityRow[];
  showAccuracy: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Question</TableHead>
            <TableHead>Subject</TableHead>
            {showAccuracy && <TableHead className="text-right">Correct</TableHead>}
            <TableHead className="text-right">Attempts</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.question_id}>
              <TableCell className="max-w-96">
                <Link
                  href={`/admin/questions/${row.question_id}`}
                  className="block truncate font-medium hover:underline"
                  title={row.stem ?? undefined}
                >
                  {row.stem ?? row.question_id}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.subjectName ?? "—"}
              </TableCell>
              {showAccuracy && (
                <TableCell className="text-right tabular-nums">
                  {accuracyPctOf(row) !== null ? `${accuracyPctOf(row)}%` : "—"}
                </TableCell>
              )}
              <TableCell className="text-right tabular-nums">
                {row.attempts_count}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={showAccuracy ? 4 : 3} className="text-muted-foreground">
                Nothing here — good sign.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Question-bank health, recomputed nightly. Hard/easy rankings only include
 * questions with ≥{@link QUESTION_MIN_ATTEMPTS} attempts so noise cannot
 * rank; cold is "never attempted at all".
 */
export function ContentQualitySection({ data }: { data: QualityData }) {
  return (
    <section aria-labelledby="quality-heading" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="quality-heading" className="font-display text-xl font-semibold">
          Question quality
        </h2>
        {data.computedAt !== null && (
          <p className="text-xs text-muted-foreground">
            Recomputed {new Date(data.computedAt).toLocaleString("en-GB")}
          </p>
        )}
      </div>

      {data.computedAt === null ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No question stats yet — they build with the nightly rollup.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Hardest questions</CardTitle>
                <CardDescription>
                  Lowest correct-rate with at least {QUESTION_MIN_ATTEMPTS}{" "}
                  attempts — first candidates for a rewrite or a better
                  explanation.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <QuestionList rows={data.hardest} showAccuracy />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Suspiciously easy</CardTitle>
                <CardDescription>
                  Near-perfect correct-rates — possibly broken, leaked, or
                  giving the answer away.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <QuestionList rows={data.suspiciouslyEasy} showAccuracy />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>
                  Never attempted
                  {data.coldTotal > data.cold.length &&
                    ` — ${data.coldTotal} total, showing ${data.cold.length}`}
                </CardTitle>
                <CardDescription>
                  Published questions no student has ever answered — dead
                  inventory, or subjects nobody selects.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <QuestionList rows={data.cold} showAccuracy={false} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Coverage by subject</CardTitle>
                <CardDescription>
                  Question supply against all-time attempt demand — high
                  attempts-per-question means the bank is thin where students
                  actually practise.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Subject</TableHead>
                        <TableHead>Exam</TableHead>
                        <TableHead className="text-right">Questions</TableHead>
                        <TableHead className="text-right">Attempts</TableHead>
                        <TableHead className="text-right">Per question</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.coverage.map((row) => (
                        <TableRow key={row.subjectId}>
                          <TableCell className="font-medium">
                            {row.subjectName}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {row.examName || "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.questionCount}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.attempts}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.attemptsPerQuestion ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                      {data.coverage.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-muted-foreground">
                            No subjects yet.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </section>
  );
}
