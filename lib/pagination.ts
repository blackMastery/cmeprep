/**
 * Which page numbers a numbered pager should show, with "gap" markers where
 * runs are elided: first/last pages always, the current page ±1, and any
 * would-be gap of exactly one page filled in (an ellipsis must never hide a
 * single page — the number itself is shorter).
 */
export function pageWindow(
  current: number,
  pageCount: number
): (number | "gap")[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }

  const shown = [
    ...new Set(
      [1, current - 1, current, current + 1, pageCount].filter(
        (p) => p >= 1 && p <= pageCount
      )
    ),
  ].sort((a, b) => a - b);

  const out: (number | "gap")[] = [];
  for (const [i, p] of shown.entries()) {
    if (i > 0) {
      const prev = shown[i - 1];
      if (p - prev === 2) out.push(p - 1);
      else if (p - prev > 2) out.push("gap");
    }
    out.push(p);
  }
  return out;
}
