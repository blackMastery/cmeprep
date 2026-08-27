"use client";

import { useId } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
} from "@/lib/admin/question-filters-core";
import { SELECT_CLASS } from "@/components/admin/question-filters";

/**
 * Rows-per-page picker for the server-rendered question list. Navigates with
 * the current filters intact and `page` dropped: page 7 of 20 is a different
 * slice of the data at 100 per page, so the only honest landing spot is the
 * first page of the new size.
 */
export function PageSizeSelect({ value }: { value: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const id = useId();

  const onChange = (next: string) => {
    const qs = new URLSearchParams(sp.toString());
    qs.delete("page");
    if (Number(next) === DEFAULT_PAGE_SIZE) qs.delete("perPage");
    else qs.set("perPage", next);
    const s = qs.toString();
    router.push(s ? `${pathname}?${s}` : pathname);
  };

  return (
    <label
      htmlFor={id}
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      <span>Per page</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${SELECT_CLASS} h-8 text-xs tabular-nums`}
      >
        {PAGE_SIZE_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}
