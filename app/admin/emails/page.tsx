import type { Metadata } from "next";
import Link from "next/link";
import {
  getEmailOverview,
  isOutboxFilter,
  listOutbox,
  OUTBOX_FILTERS,
  OUTBOX_PAGE_SIZE,
  type OutboxFilter,
} from "@/lib/admin/emails";
import { unsubscribeLinks } from "@/lib/email";
import {
  EMAIL_TEMPLATES,
  isEmailTemplate,
  isTransactional,
  renderEmail,
} from "@/lib/email-core";
import { EMAIL_SAMPLES } from "@/lib/email-samples";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SummaryTile } from "@/components/admin/summary-tile";
import { EmailRunControls, EmailTestPanel } from "@/components/admin/email-controls";
import { EmailsTable } from "@/components/admin/emails-table";

export const metadata: Metadata = { title: "Emails" };

// Run delivery / Run daily scan are Server Actions on this page and budget
// against EMAIL_BUDGET_MS (45s) like the cron route; the platform default
// would cut them off mid-claim and re-open the duplicate-send window the
// claim exists to close. Page-level maxDuration governs a page's Server
// Actions (see app/admin/translations/page.tsx).
export const maxDuration = 60;

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : undefined;
}

const runFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** "3h ago" for the last-run tiles; the exact time is the hint. */
function ago(iso: string, now: Date): string {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** A preview token that can never match a real row — the link still shows. */
const PREVIEW_TOKEN = "00000000-0000-4000-8000-000000000000";

/**
 * The outbox monitor and template tester (notifications-plan.md). Reads
 * only, except through the three Server Actions in ./actions.ts (run a job,
 * re-queue a row, send yourself a sample), each audited.
 */
export default async function AdminEmailsPage(props: PageProps<"/admin/emails">) {
  const sp = await props.searchParams;
  const now = new Date();

  const requested = one(sp.filter);
  const filter: OutboxFilter = isOutboxFilter(requested) ? requested : "all";
  const previewKey = one(sp.preview);
  const preview = isEmailTemplate(previewKey) ? previewKey : null;

  const [overview, outbox] = await Promise.all([
    getEmailOverview(now),
    listOutbox({ filter, page: Number(one(sp.page) ?? 1) || 1 }),
  ]);

  const rendered = preview
    ? renderEmail(preview, EMAIL_SAMPLES[preview], {
        // The same link shape the worker sends, against a token that
        // resolves to nobody.
        unsubscribeUrl: unsubscribeLinks(PREVIEW_TOKEN, preview)?.page ?? null,
      })
    : null;

  const templates = EMAIL_TEMPLATES.map((key) => ({
    key,
    label: key.replace(/_/g, " "),
    transactional: isTransactional(key),
  }));

  const scanStale =
    !overview.lastScan ||
    now.getTime() - new Date(overview.lastScan.at).getTime() > 36 * 3_600_000 ||
    Boolean(overview.lastScan.meta?.error);
  // A run that threw (transport misconfigured) writes its error into the
  // heartbeat row; that is a red tile, not a fresh timestamp.
  const deliverFailed = Boolean(overview.lastDeliver?.meta?.error);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Emails</h1>
        <p className="mt-1 text-muted-foreground">
          The outbox: every email the app has queued. Rows send the moment
          they are queued; the five-minute job retries failures and delivers
          the daily scan&apos;s rows. Transport is{" "}
          <strong>{overview.transport}</strong>
          {overview.transport === "log" &&
            " — nothing is sent; the delivery run prints each email to the server console"}
          .
        </p>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryTile
          label="Queued, due now"
          value={String(overview.queuedDue)}
          hint={overview.queuedLater > 0 ? `+${overview.queuedLater} retrying later` : undefined}
        />
        <SummaryTile label="Sent, 7 days" value={String(overview.sent7d)} />
        <SummaryTile label="Skipped, 7 days" value={String(overview.skipped7d)} />
        <SummaryTile
          label="Failed"
          value={String(overview.failed)}
          hint="parked at the attempt cap"
          warn={overview.failed > 0}
        />
        <SummaryTile
          label="Last scheduled delivery"
          value={overview.lastDeliver ? ago(overview.lastDeliver.at, now) : "never"}
          hint={
            deliverFailed
              ? String(overview.lastDeliver?.meta?.error)
              : overview.lastDeliver
                ? runFormatter.format(new Date(overview.lastDeliver.at))
                : "logged only when a run had rows"
          }
          warn={deliverFailed}
        />
        <SummaryTile
          label="Last daily scan"
          value={overview.lastScan ? ago(overview.lastScan.at, now) : "never"}
          hint={
            overview.lastScan
              ? runFormatter.format(new Date(overview.lastScan.at))
              : "schedule it (see the migration)"
          }
          warn={scanStale}
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <EmailRunControls />
        <EmailTestPanel templates={templates} selected={preview} />
      </div>

      {rendered && preview && (
        <Card className="mb-6 [--card-spacing:--spacing(5)]">
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-lg">
                Preview: <span className="font-mono text-base">{preview}</span>
              </h2>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/admin/emails">Close</Link>
              </Button>
            </div>
            <p className="text-sm">
              <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Subject:{" "}
              </span>
              {rendered.subject}
            </p>
            {/* sandbox with no allowances: the HTML is ours, but a preview
                frame that could run script or navigate the admin is a habit
                not worth forming. */}
            <iframe
              title={`Preview of ${preview}`}
              srcDoc={rendered.html}
              sandbox=""
              className="h-[36rem] w-full rounded-lg border border-border bg-white"
            />
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">
                Plain-text version
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/60 p-3 text-xs whitespace-pre-wrap">
                {rendered.text}
              </pre>
            </details>
          </CardContent>
        </Card>
      )}

      <nav className="mb-4 flex flex-wrap items-center gap-1" aria-label="Filter">
        {OUTBOX_FILTERS.map((f) => (
          <Button key={f} variant={f === filter ? "default" : "ghost"} size="sm" asChild>
            <Link
              href={f === "all" ? "/admin/emails" : `/admin/emails?filter=${f}`}
              aria-current={f === filter ? "page" : undefined}
            >
              {f}
            </Link>
          </Button>
        ))}
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">
          {outbox.total} {filter === "all" ? "emails" : filter}
        </span>
      </nav>

      <EmailsTable rows={outbox.rows} />

      {outbox.pageCount > 1 && (
        <nav className="mt-6 flex items-center justify-between gap-2" aria-label="Pagination">
          <Button
            variant="outline-muted"
            size="sm"
            disabled={outbox.page <= 1}
            asChild={outbox.page > 1}
          >
            {outbox.page > 1 ? (
              <Link href={pageHref(filter, outbox.page - 1)}>Previous</Link>
            ) : (
              <span>Previous</span>
            )}
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            Page {outbox.page} of {outbox.pageCount} · {OUTBOX_PAGE_SIZE} per page
          </span>
          <Button
            variant="outline-muted"
            size="sm"
            disabled={outbox.page >= outbox.pageCount}
            asChild={outbox.page < outbox.pageCount}
          >
            {outbox.page < outbox.pageCount ? (
              <Link href={pageHref(filter, outbox.page + 1)}>Next</Link>
            ) : (
              <span>Next</span>
            )}
          </Button>
        </nav>
      )}
    </div>
  );
}

function pageHref(filter: OutboxFilter, page: number): string {
  const qs = new URLSearchParams();
  if (filter !== "all") qs.set("filter", filter);
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `/admin/emails?${s}` : "/admin/emails";
}
