import Link from "next/link";
import { pageWindow } from "@/lib/pagination";
import { Button } from "@/components/ui/button";

/**
 * Numbered pagination bar for any server-rendered list page. Links preserve
 * the current searchParams (minus `page`, which is dropped when 1 for clean
 * URLs). Number row collapses to "Page X of Y" below sm. `sizeControl` is
 * the admin lists' rows-per-page picker, rendered on the footer's right.
 */
export function Pager({
  page,
  pageCount,
  total,
  shown,
  pageSize,
  basePath,
  params,
  sizeControl,
}: {
  page: number;
  pageCount: number;
  total: number;
  shown: number;
  pageSize: number;
  basePath: string;
  params: Record<string, string | string[] | undefined>;
  sizeControl?: React.ReactNode;
}) {
  // A page beyond the end (stale link after deletes) renders an empty list;
  // navigate relative to the real last page so Previous recovers.
  const current = Math.min(page, pageCount);
  const first = (page - 1) * pageSize + 1;

  const href = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === "page") continue;
      const value = Array.isArray(v) ? v[0] : v;
      if (value) qs.set(k, value);
    }
    if (p > 1) qs.set("page", String(p));
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
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

      {sizeControl ? (
        // Three equal columns keep the count centred under the page buttons
        // regardless of how wide the picker on the right renders.
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <span />
          <p className="text-xs text-muted-foreground tabular-nums">
            {shown > 0 && `Showing ${first}–${first + shown - 1} of ${total}`}
          </p>
          <div className="justify-self-end">{sizeControl}</div>
        </div>
      ) : (
        shown > 0 && (
          <p className="text-center text-xs text-muted-foreground tabular-nums">
            Showing {first}–{first + shown - 1} of {total}
          </p>
        )
      )}
    </div>
  );
}
