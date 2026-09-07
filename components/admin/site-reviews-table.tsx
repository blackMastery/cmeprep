"use client";

import { useActionState } from "react";
import { MessageSquareQuote } from "lucide-react";
import type { AdminSiteReview } from "@/lib/admin/site-reviews";
import type { AdminState } from "@/app/admin/subjects/actions";
import {
  moderateSiteReview,
  setSiteReviewFeatured,
} from "@/app/admin/reviews/actions";
import { REVIEW_STATUS_LABELS } from "@/lib/site-reviews-core";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FormMessage } from "@/components/auth/form-parts";
import { AdminSubmit } from "@/components/admin/form-parts";
import { Stars } from "@/components/marketing/review-stars";

// timeZone pinned for the same reason as the marketing card: this component
// is server-rendered before it hydrates, so an unpinned formatter renders one
// day on a UTC server and the previous day in a moderator's browser west of
// it — a hydration mismatch on every review created late in the evening.
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function SiteReviewsTable({ rows }: { rows: AdminSiteReview[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <MessageSquareQuote
            className="mx-auto size-6 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="mt-3 font-display text-lg">Nothing here</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Reviews students write about the product land here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.id}>
          <SiteReviewCard row={row} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One review, shown IN FULL.
 *
 * A card list, not a table: the body is the point, and a moderator has to
 * read all of it before deciding. There is deliberately no edit control —
 * an admin never changes a reviewer's words. Approve, reject, feature: that
 * is the whole surface.
 */
function SiteReviewCard({ row }: { row: AdminSiteReview }) {
  const [moderateState, moderateAction] = useActionState<AdminState, FormData>(
    moderateSiteReview,
    null,
  );
  const [featureState, featureAction] = useActionState<AdminState, FormData>(
    setSiteReviewFeatured,
    null,
  );

  return (
    <Card
      className={cn(
        "[--card-spacing:--spacing(5)]",
        row.status === "rejected" && "opacity-70",
      )}
    >
      <CardContent className="space-y-3">
        {/* Each action reports its OWN result. useActionState is sticky and
            the card is never remounted, so coalescing the two whole states
            let a stale "Published." hide a later feature failure entirely —
            the moderator would think a quote was on the marketing page when
            it was not. Same shape as messages-table.tsx: combine the fields,
            not the states. */}
        <FormMessage
          error={moderateState?.error ?? featureState?.error}
          success={
            moderateState?.error || featureState?.error
              ? undefined
              : (moderateState?.success ?? featureState?.success)
          }
        />

        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <Stars value={row.rating} size="sm" />
            <p className="mt-1 font-medium">{row.display_name}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {row.featured && <Badge>On the marketing page</Badge>}
            <Badge variant={row.status === "pending" ? "default" : "outline"}>
              {REVIEW_STATUS_LABELS[row.status]}
            </Badge>
            <span className="text-xs text-muted-foreground tabular-nums">
              {dateFormatter.format(new Date(row.created_at))}
            </span>
          </div>
        </div>

        {/* whitespace-pre-line: the author's paragraph breaks carry meaning,
            and this is the copy that will be published verbatim. */}
        <p className="whitespace-pre-line break-words text-sm leading-relaxed">
          {row.body}
        </p>

        <div className="flex flex-wrap items-center gap-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <span className="mr-auto">
            {row.verified_purchase ? "Verified purchase" : "No purchase"}
            {" · "}
            {row.role_at_submit}
            {row.exam_name ? ` · ${row.exam_name}` : ""}
          </span>

          {row.status === "approved" && (
            <form action={featureAction}>
              <input type="hidden" name="id" value={row.id} />
              <input
                type="hidden"
                name="featured"
                value={row.featured ? "false" : "true"}
              />
              <AdminSubmit variant="ghost" size="xs">
                {row.featured ? "Unfeature" : "Feature"}
              </AdminSubmit>
            </form>
          )}

          {row.status !== "approved" && (
            <form action={moderateAction}>
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="decision" value="approve" />
              {/* The status this button was RENDERED against — the action
                  compare-and-swaps on it so a stale tab cannot overwrite a
                  verdict it never saw. */}
              <input type="hidden" name="from" value={row.status} />
              <AdminSubmit variant="ghost" size="xs">
                {row.status === "rejected" ? "Publish anyway" : "Publish"}
              </AdminSubmit>
            </form>
          )}

          {row.status !== "rejected" && (
            <form action={moderateAction}>
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="decision" value="reject" />
              <input type="hidden" name="from" value={row.status} />
              <AdminSubmit variant="ghost" size="xs">
                {row.status === "approved" ? "Unpublish" : "Reject"}
              </AdminSubmit>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
