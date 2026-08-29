import { translatedAttrs } from "@/lib/translation-ui-core";

/** Explanation strip — matches the marketing page's sample card. Shared by
 * post-test review and the tutor/OSCE runners' reveal panels. The heading
 * stays English; only the body carries the translation's lang/dir. */
export function ExplanationStrip({
  explanation,
  translated = null,
}: {
  explanation: string;
  /** Set when `explanation` is a translation. */
  translated?: { language: string } | null;
}) {
  return (
    <div className="rounded-xl border-l-2 border-primary bg-secondary/60 px-4 py-3.5">
      <p className="mb-1 text-xs font-semibold tracking-wide text-primary uppercase">
        Explanation
      </p>
      <p
        className="text-sm leading-relaxed text-foreground/90"
        {...translatedAttrs(translated?.language ?? null)}
      >
        {explanation}
      </p>
    </div>
  );
}
