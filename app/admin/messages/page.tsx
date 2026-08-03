import type { Metadata } from "next";
import Link from "next/link";
import {
  listMessages,
  MESSAGES_PAGE_SIZE,
  type MessageFilter,
} from "@/lib/admin/messages";
import { pageWindow } from "@/lib/pagination";
import { Button } from "@/components/ui/button";
import { MessagesTable } from "@/components/admin/messages-table";

export const metadata: Metadata = { title: "Messages" };

const FILTERS: readonly { value: MessageFilter; label: string }[] = [
  { value: "unhandled", label: "Open" },
  { value: "handled", label: "Handled" },
  { value: "all", label: "All" },
];

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : undefined;
}

export default async function AdminMessagesPage(
  props: PageProps<"/admin/messages">
) {
  const sp = await props.searchParams;

  const requested = one(sp.filter);
  const filter: MessageFilter = FILTERS.some((f) => f.value === requested)
    ? (requested as MessageFilter)
    : "unhandled";

  const result = await listMessages({
    filter,
    page: Number(one(sp.page) ?? 1) || 1,
  });

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Messages
        </h1>
        <p className="mt-1 text-muted-foreground">
          {result.unhandled === 0
            ? "Nothing waiting on a reply."
            : `${result.unhandled} waiting on a reply.`}{" "}
          Sent from the contact form on the About page.
        </p>
      </header>

      <nav className="mb-6 flex flex-wrap items-center gap-1" aria-label="Filter">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            variant={f.value === filter ? "default" : "ghost"}
            size="sm"
            asChild
          >
            <Link
              href={
                f.value === "unhandled"
                  ? "/admin/messages"
                  : `/admin/messages?filter=${f.value}`
              }
              aria-current={f.value === filter ? "page" : undefined}
            >
              {f.label}
            </Link>
          </Button>
        ))}
      </nav>

      <MessagesTable rows={result.rows} />

      {result.pageCount > 1 && (
        <Pager
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          shown={result.rows.length}
          filter={filter}
        />
      )}
    </div>
  );
}

function Pager({
  page,
  pageCount,
  total,
  shown,
  filter,
}: {
  page: number;
  pageCount: number;
  total: number;
  shown: number;
  filter: MessageFilter;
}) {
  // A page beyond the end (stale link after deletes) renders an empty list;
  // navigate relative to the real last page so Previous recovers.
  const current = Math.min(page, pageCount);
  const first = (page - 1) * MESSAGES_PAGE_SIZE + 1;

  const href = (p: number) => {
    const qs = new URLSearchParams();
    if (filter !== "unhandled") qs.set("filter", filter);
    if (p > 1) qs.set("page", String(p));
    const s = qs.toString();
    return s ? `/admin/messages?${s}` : "/admin/messages";
  };

  return (
    <div className="mt-6 space-y-2">
      <nav
        className="flex items-center justify-between gap-2"
        aria-label="Pagination"
      >
        <Button
          variant="outline-muted"
          size="sm"
          disabled={current <= 1}
          asChild={current > 1}
        >
          {current > 1 ? (
            <Link href={href(current - 1)}>Previous</Link>
          ) : (
            <span>Previous</span>
          )}
        </Button>

        <div className="hidden items-center gap-1 sm:flex">
          {pageWindow(current, pageCount).map((item, i) =>
            item === "gap" ? (
              <span
                key={`gap-${i}`}
                aria-hidden
                className="px-1 text-sm text-muted-foreground"
              >
                …
              </span>
            ) : (
              <Button
                key={item}
                variant={item === current ? "default" : "ghost"}
                size="sm"
                className="min-w-8 px-2 tabular-nums"
                asChild
              >
                <Link
                  href={href(item)}
                  aria-current={item === current ? "page" : undefined}
                >
                  {item}
                </Link>
              </Button>
            )
          )}
        </div>
        <span className="text-sm text-muted-foreground tabular-nums sm:hidden">
          Page {current} of {pageCount}
        </span>

        <Button
          variant="outline-muted"
          size="sm"
          disabled={current >= pageCount}
          asChild={current < pageCount}
        >
          {current < pageCount ? (
            <Link href={href(current + 1)}>Next</Link>
          ) : (
            <span>Next</span>
          )}
        </Button>
      </nav>

      {shown > 0 && (
        <p className="text-center text-xs text-muted-foreground tabular-nums">
          Showing {first}–{first + shown - 1} of {total}
        </p>
      )}
    </div>
  );
}
