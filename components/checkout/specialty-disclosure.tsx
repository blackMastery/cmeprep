"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { CatalogSpecialty } from "@/lib/catalog-core";
import { cn } from "@/lib/utils";

/**
 * One specialty row that opens to reveal its subjects.
 *
 * Hand-rolled rather than a Radix Accordion, matching the repo's existing
 * disclosure idiom (bookmark-card, subject-detail): there is no animation
 * requirement, and accordion semantics would force one-specialty-at-a-time,
 * which is wrong for a buyer comparing coverage across specialties.
 * `aria-controls` is added here because the panel is a sibling, not a child.
 */
export function SpecialtyDisclosure({
  specialty,
  summary,
}: {
  specialty: CatalogSpecialty;
  /** Pre-formatted subject-count line — built server-side to keep this client leaf small. */
  summary: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `${useId()}-panel`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium wrap-break-word">
            {specialty.name}
          </span>
          <span className="block text-xs text-muted-foreground">{summary}</span>
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id={panelId}
          className="space-y-3 border-t border-border bg-muted/30 px-3 py-3"
        >
          {specialty.subjects.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No subjects published yet.
            </p>
          ) : (
            specialty.subjects.map((subject) => (
              <p
                key={subject.id}
                className="text-sm font-medium wrap-break-word"
              >
                {subject.name}
              </p>
            ))
          )}
        </div>
      )}
    </>
  );
}
