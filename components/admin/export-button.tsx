import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  questionFiltersQueryString,
  type SearchParamsLike,
} from "@/lib/admin/question-filters-core";

/**
 * "Export N questions" — downloads whatever the current filters match.
 *
 * A plain <a>, not <Link>: the route returns the answer key, and a Next.js
 * prefetch on hover would fire a full (audited) export for nothing. Disabled
 * at zero because a header-only sheet is just the template.
 */
export function ExportButton({
  total,
  params,
}: {
  total: number;
  params: SearchParamsLike;
}) {
  const qs = questionFiltersQueryString(params);
  const href = `/api/admin/questions/export${qs ? `?${qs}` : ""}`;
  const label = `Export ${total.toLocaleString()} question${total === 1 ? "" : "s"}`;

  if (total === 0) {
    return (
      <Button size="lg" variant="outline-muted" disabled>
        <Download data-icon="inline-start" />
        {label}
      </Button>
    );
  }
  return (
    <Button size="lg" variant="outline-muted" asChild>
      <a href={href} download>
        <Download data-icon="inline-start" />
        {label}
      </a>
    </Button>
  );
}
