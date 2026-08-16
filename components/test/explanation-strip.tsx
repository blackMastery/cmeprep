/** Explanation strip — matches the marketing page's sample card. Shared by
 * post-test review and the tutor runner's reveal panel. */
export function ExplanationStrip({ explanation }: { explanation: string }) {
  return (
    <div className="rounded-xl border-l-2 border-primary bg-secondary/60 px-4 py-3.5">
      <p className="mb-1 text-xs font-semibold tracking-wide text-primary uppercase">
        Explanation
      </p>
      <p className="text-sm leading-relaxed text-foreground/90">{explanation}</p>
    </div>
  );
}
