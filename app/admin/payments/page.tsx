import type { Metadata } from "next";
import Link from "next/link";
import { listPayments, PAYMENTS_PAGE_SIZE } from "@/lib/admin/payments";
import { listExamOptions } from "@/lib/analytics";
import { analyticsDaySchema } from "@/lib/validation";
import { priceLabel } from "@/lib/format";
import type { PaymentStatus } from "@/lib/supabase/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/pager";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = { title: "Payments" };

const SELECT_CLASS =
  "h-9 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const STATUSES: readonly PaymentStatus[] = [
  "captured",
  "partially_refunded",
  "refunded",
  "denied",
  "reversed",
];

const STATUS_LABEL: Record<PaymentStatus, string> = {
  captured: "Captured",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  denied: "Denied",
  reversed: "Reversed",
};

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : undefined;
}

function money(cents: number | null, currency: string | null): string {
  if (cents === null) return "—";
  const label = priceLabel(cents);
  return currency === null || currency === "USD" ? label : `${label} ${currency}`;
}

/**
 * The drill-down behind the dashboard's revenue rows and ops alerts: raw
 * payments, filterable by capture day / exam / status, plus the "unclaimed"
 * view (money captured, no grant) the reconcile sweep works through.
 */
export default async function AdminPaymentsPage(
  props: PageProps<"/admin/payments">
) {
  const sp = await props.searchParams;

  const rawDay = one(sp.day);
  const day = analyticsDaySchema.safeParse(rawDay).success ? rawDay : undefined;
  const rawStatus = one(sp.status);
  const status = STATUSES.includes(rawStatus as PaymentStatus)
    ? (rawStatus as PaymentStatus)
    : undefined;
  const unclaimed = one(sp.unclaimed) === "1";

  const exams = await listExamOptions();
  const requestedExam = one(sp.exam);
  const examId = exams.some((e) => e.id === requestedExam)
    ? requestedExam
    : undefined;

  const result = await listPayments({
    day,
    examId,
    status,
    unclaimed,
    page: Number(one(sp.page) ?? 1) || 1,
  });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Payments
        </h1>
        <p className="mt-1 text-muted-foreground">
          {result.total} payment{result.total === 1 ? "" : "s"}
          {day || examId || status || unclaimed ? " matching" : " recorded"}.
          Amounts are what PayPal actually moved, never the plan price.
        </p>
      </header>

      <form
        method="get"
        action="/admin/payments"
        className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"
      >
        <Input
          name="day"
          type="date"
          defaultValue={day ?? ""}
          aria-label="Capture day"
          className="h-9 w-40"
        />

        <select
          name="exam"
          defaultValue={examId ?? ""}
          aria-label="Exam"
          className={SELECT_CLASS}
        >
          <option value="">All exams</option>
          {exams.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>

        <select
          name="status"
          defaultValue={status ?? ""}
          aria-label="Status"
          className={SELECT_CLASS}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            name="unclaimed"
            value="1"
            defaultChecked={unclaimed}
            className="size-4 accent-primary"
          />
          Unclaimed only
        </label>

        <Button type="submit" size="sm">
          Filter
        </Button>
        <Button variant="ghost" size="sm" type="button" asChild>
          <Link href="/admin/payments">Reset</Link>
        </Button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Captured</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead>Exam</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Refunded</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map(({ payment, buyerName, buyerEmail, examName }) => (
              <TableRow key={payment.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {new Date(payment.captured_at).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </TableCell>
                <TableCell>
                  {payment.user_id ? (
                    <Link
                      href={`/admin/users/${payment.user_id}`}
                      className="block hover:underline"
                    >
                      <span className="block font-medium">
                        {buyerName ?? "—"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {buyerEmail ?? ""}
                      </span>
                    </Link>
                  ) : (
                    <span
                      className="text-xs text-muted-foreground"
                      title={payment.custom_id ?? undefined}
                    >
                      Profile deleted
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {examName ??
                    (payment.grant_failure === null ? "All-access" : "—")}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {payment.plan_name ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(payment.amount_cents, payment.currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {payment.refunded_cents > 0
                    ? money(payment.refunded_cents, payment.currency)
                    : "—"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge
                      variant={
                        payment.status === "captured" ? "secondary" : "outline"
                      }
                    >
                      {STATUS_LABEL[payment.status]}
                    </Badge>
                    {payment.grant_failure !== null && (
                      <Badge variant="destructive">
                        {payment.grant_failure.replaceAll("_", " ")}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {payment.source}
                  {payment.org_id !== null && " · org"}
                </TableCell>
              </TableRow>
            ))}
            {result.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground">
                  {unclaimed
                    ? "No unclaimed payments — every capture has its grant."
                    : "No payments match these filters."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {result.total > 0 && (
        <Pager
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          shown={result.rows.length}
          pageSize={PAYMENTS_PAGE_SIZE}
          basePath="/admin/payments"
          params={sp}
        />
      )}
    </div>
  );
}
