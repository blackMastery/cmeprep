"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { LANGUAGES } from "@/lib/translation-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SELECT_CLASS } from "@/components/admin/question-filters";

/**
 * Plain GET form, like the question list's: server-rendered, shareable by
 * URL, works without JS. Lists every registry language that has rows or is
 * enabled, so a disabled language's leftovers can still be found.
 */
export function TranslationFilters({
  languageCodes,
}: {
  /** Codes worth offering: enabled, or with cached rows. */
  languageCodes: string[];
}) {
  const sp = useSearchParams();
  const get = (k: string) => sp.get(k) ?? "";
  const languages = LANGUAGES.filter((l) => languageCodes.includes(l.code));

  return (
    <form
      method="get"
      action="/admin/translations"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"
    >
      <div className="relative min-w-48 flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          name="q"
          type="search"
          defaultValue={get("q")}
          placeholder="Question id or stem…"
          aria-label="Search translations"
          className="h-9 pl-8"
        />
      </div>

      <select
        name="lang"
        defaultValue={get("lang")}
        aria-label="Language"
        className={SELECT_CLASS}
      >
        <option value="">All languages</option>
        {languages.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>

      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>From</span>
        <input
          type="date"
          name="from"
          defaultValue={get("from")}
          aria-label="Updated from"
          className={SELECT_CLASS}
        />
      </label>
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>To</span>
        <input
          type="date"
          name="to"
          defaultValue={get("to")}
          aria-label="Updated to"
          className={SELECT_CLASS}
        />
      </label>

      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <input
          type="checkbox"
          name="stale"
          value="1"
          defaultChecked={get("stale") === "1"}
          className="size-4 accent-[var(--primary)]"
        />
        Stale only
      </label>

      <Button type="submit" size="sm">
        Filter
      </Button>
      <Button variant="ghost" size="sm" type="button" asChild>
        <Link href="/admin/translations">Reset</Link>
      </Button>
    </form>
  );
}
