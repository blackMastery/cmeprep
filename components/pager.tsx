import Link from "next/link";
import { pageWindow } from "@/lib/pagination";
import { Button } from "@/components/ui/button";

/**
 * Numbered pagination bar for any server-rendered list page. Links preserve
 * the current searchParams (minus `page`, which is dropped when 1 for clean
 * URLs). Number row collapses to "Page X of Y" below sm.
 */
export function Pager({
  page,
  pageCount,
  total,
  shown,
  pageSize,
  basePath,
  params,
}: {
  page: number;
  pageCount: number;
  total: number;
  shown: number;
  pageSize: number;
  basePath: string;
  params: Record<string, string | string[] | undefined>;
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

      {shown > 0 && (
        <p className="text-center text-xs text-muted-foreground tabular-nums">
          Showing {first}–{first + shown - 1} of {total}
        </p>
      )}
    </div>
  );
}
