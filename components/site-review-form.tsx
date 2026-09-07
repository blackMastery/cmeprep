"use client";

import { useId, useRef, useState } from "react";
import { AlertTriangle, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  REVIEW_BODY_MAX,
  REVIEW_RATING_MAX,
  reviewBodyIssue,
  reviewBodyLength,
  reviewBannerKey,
} from "@/lib/site-reviews-core";
import { cn } from "@/lib/utils";

/**
 * The review form, shared by all three entry points (profile card, results
 * prompt, dashboard banner) so the publication licence and the permanence
 * warning are worded identically wherever someone meets it.
 */

/** The one caller of POST /api/reviews. Module-private: it validates nothing,
 * so a second caller would post straight past the rating and consent checks
 * below. Never throws. */
async function postSiteReview(body: {
  rating: number;
  body: string;
  consent: true;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    return { ok: false, error: data?.error ?? "Could not save your review" };
  } catch {
    return { ok: false, error: "Could not save your review" };
  }
}

export function SiteReviewForm({
  userId,
  displayName,
}: {
  /** Used only to write the banner-dismissal key on success. */
  userId: string;
  /** The EXACT string that will be published, from reviewDisplayName(). Shown
   * beside the consent box: a licence to publish a name you were never shown
   * is not informed consent, and this is irreversible — email signups with no
   * profile name are published under a fallback they would otherwise never
   * see. */
  displayName: string;
}) {
  const bodyId = useId();
  const hintId = useId();
  const consentId = useId();

  const [rating, setRating] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const bodyLength = reviewBodyLength(body);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Validated on submit rather than by disabling the button: a disabled
    // button gives no reason, which is the complaint ReportForm already
    // answers the same way.
    if (rating === null) return setError("Pick a rating.");
    const issue = reviewBodyIssue(body);
    if (issue) return setError(issue);
    if (!consent) return setError("Tick the box to let us publish it.");

    setError(null);
    setSubmitting(true);
    const result = await postSiteReview({ rating, body, consent: true });
    setSubmitting(false);

    if (!result.ok)
      return setError(result.error ?? "Could not save your review");

    try {
      window.localStorage.setItem(reviewBannerKey(userId), "1");
    } catch {
      // Private mode, or site data blocked. The banner is a nudge; losing the
      // dismissal is not worth failing a successful submit over.
    }
    toast.success("Thanks — your review is with us for approval.");
    setDone(true);
    // Deliberately no router.refresh() and no close callback. Either one
    // re-renders the server, which stops rendering this surface at all
    // (hasReviewed is now true) and tears the confirmation below off the
    // screen before it is read — on the one screen that has to say the review
    // is permanent and unnotified. The page catches up on the next
    // navigation; the localStorage key above keeps the banner away until then.
  }

  if (done) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Awaiting approval. We&rsquo;ll publish it once it&rsquo;s been checked;
        you won&rsquo;t get an email.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <StarRatingInput value={rating} onChange={setRating} />

      <div className="space-y-1.5">
        <Label htmlFor={bodyId}>Your review</Label>
        <Textarea
          id={bodyId}
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={REVIEW_BODY_MAX}
          aria-describedby={hintId}
          placeholder="What worked for you, and who would you recommend it to?"
        />
        <div className="flex items-start justify-between gap-3">
          <p id={hintId} className="text-xs text-muted-foreground">
            Up to {REVIEW_BODY_MAX} characters. Published exactly as written.
          </p>
          {/* Counts what the DATABASE will count — the normalized body, in
              code points. The raw .length disagrees on emoji and on padded
              blank lines, which is what let an over-long body through to a
              CHECK violation. aria-hidden because a counter announced on
              every keystroke is hostile, and the cap is in the hint above. */}
          <p
            aria-hidden="true"
            className={cn(
              "shrink-0 text-xs tabular-nums text-muted-foreground",
              bodyLength > REVIEW_BODY_MAX && "text-destructive",
            )}
          >
            {bodyLength}/{REVIEW_BODY_MAX}
          </p>
        </div>
      </div>

      {/* Caution, not an error — sun, never destructive. */}
      <div className="flex gap-3 rounded-lg border border-sun/50 bg-sun/10 p-3 text-sm">
        <AlertTriangle
          className="mt-0.5 size-4 shrink-0 text-sun-deep"
          aria-hidden="true"
        />
        <p>
          Reviews are permanent. Once you send this you can&rsquo;t edit it or
          take it down yourself, and we don&rsquo;t email you when it&rsquo;s
          published. One review per account — write it as you want it to stand.
        </p>
      </div>

      <div className="flex items-start gap-2.5">
        <Checkbox
          id={consentId}
          checked={consent}
          onCheckedChange={(v) => setConsent(v === true)}
          className="mt-0.5"
        />
        <Label
          htmlFor={consentId}
          className="text-sm leading-relaxed font-normal"
        >
          I agree that cmeqbank.com may publish this review on its website and
          in marketing materials, credited to{" "}
          <span className="font-medium">{displayName}</span>.
        </Label>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Sending…" : "Send review"}
      </Button>
    </form>
  );
}

/**
 * The 1-5 star picker.
 *
 * Adapted from CategoryPicker in components/report-question.tsx, but with
 * roving tabIndex and arrow-key handling on top: five stars is the case where
 * arrow keys are genuinely expected, and tabbing through five controls to set
 * one value is worse here than it is for the report chips.
 */
function StarRatingInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number) => void;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const shown = preview ?? value ?? 0;

  function move(to: number) {
    const next = Math.min(REVIEW_RATING_MAX, Math.max(1, to));
    onChange(next);
    refs.current[next - 1]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent, n: number) {
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        event.preventDefault();
        return move(n - 1);
      case "ArrowRight":
      case "ArrowUp":
        event.preventDefault();
        return move(n + 1);
      case "Home":
        event.preventDefault();
        return move(1);
      case "End":
        event.preventDefault();
        return move(REVIEW_RATING_MAX);
    }
  }

  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">Your rating</span>
      <div
        role="radiogroup"
        aria-label="Your rating"
        className="flex items-center gap-1"
        onMouseLeave={() => setPreview(null)}
      >
        {Array.from({ length: REVIEW_RATING_MAX }, (_, i) => {
          const n = i + 1;
          const active = n <= shown;
          return (
            <button
              key={n}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              // Roving tabIndex: the group is one tab stop, arrows move within.
              tabIndex={value === n || (value === null && n === 1) ? 0 : -1}
              onClick={() => onChange(n)}
              onMouseEnter={() => setPreview(n)}
              // Focus previews too, so a keyboard user sees what a mouse user
              // sees while arrowing across.
              onFocus={() => setPreview(n)}
              onBlur={() => setPreview(null)}
              onKeyDown={(e) => onKeyDown(e, n)}
              className="rounded-sm p-0.5 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <Star
                className={cn(
                  "size-7 transition-colors",
                  active ? "fill-current text-primary" : "text-primary/25",
                )}
                aria-hidden="true"
              />
            </button>
          );
        })}
        {/* Static, not aria-live: the radio's own aria-checked announcement
            already covers assistive tech, and a live region would double-speak. */}
        <span className="ml-2 text-sm text-muted-foreground">
          {value ? `${value} out of ${REVIEW_RATING_MAX}` : "Pick a rating"}
        </span>
      </div>
    </div>
  );
}

/**
 * The form in a dialog — the shape both the results prompt and the dashboard
 * banner need. Extracted so the moderation promise and the dialog title are
 * worded once; SiteReviewForm already exists for exactly that reason, and
 * duplicating the copy around it defeats the point.
 *
 * The dialog is NOT closed on success: the form swaps itself for the
 * "permanent, no email" confirmation, and the reader closes when they've read
 * it. Closing automatically is how that message went unseen.
 */
export function WriteReviewDialog({
  userId,
  displayName,
  triggerVariant = "outline",
}: {
  userId: string;
  displayName: string;
  triggerVariant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={triggerVariant}>
          Write a review
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Write a review</DialogTitle>
          <DialogDescription>
            Reviews are checked before they go up on the site.
          </DialogDescription>
        </DialogHeader>
        <SiteReviewForm userId={userId} displayName={displayName} />
      </DialogContent>
    </Dialog>
  );
}
