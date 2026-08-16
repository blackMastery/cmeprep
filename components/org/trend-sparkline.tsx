import { cn } from "@/lib/utils";

/**
 * Weekly-accuracy sparkline for the readiness table — the EcgLine idiom
 * (inline SVG polyline, currentColor) drawing real data. Weeks with no
 * attempts break the line into segments; a lone active week renders a dot.
 * Server-renderable, no client JS.
 */
export function TrendSparkline({
  series,
  className,
}: {
  series: { weekStart: string; accuracyPct: number | null }[];
  className?: string;
}) {
  const width = 120;
  const height = 32;
  const pad = 3;
  const n = series.length;
  if (n === 0 || series.every((p) => p.accuracyPct === null)) {
    return (
      <span className="text-xs text-muted-foreground" aria-hidden="true">
        —
      </span>
    );
  }

  const x = (i: number) =>
    n === 1 ? width / 2 : pad + (i * (width - pad * 2)) / (n - 1);
  const y = (pct: number) => height - pad - (pct / 100) * (height - pad * 2);

  // Consecutive non-null runs become polyline segments; singletons, dots.
  const segments: { i: number; pct: number }[][] = [];
  let run: { i: number; pct: number }[] = [];
  series.forEach((p, i) => {
    if (p.accuracyPct === null) {
      if (run.length > 0) segments.push(run);
      run = [];
    } else {
      run.push({ i, pct: p.accuracyPct });
    }
  });
  if (run.length > 0) segments.push(run);

  const last = [...series].reverse().find((p) => p.accuracyPct !== null)!;
  const tone =
    last.accuracyPct! >= 75
      ? "text-teal"
      : last.accuracyPct! >= 50
        ? "text-sun"
        : "text-destructive";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn("h-8 w-[7.5rem]", tone, className)}
      role="img"
      aria-label={`Weekly accuracy trend, latest ${last.accuracyPct}%`}
      fill="none"
    >
      {segments.map((segment) =>
        segment.length === 1 ? (
          <circle
            key={segment[0].i}
            cx={x(segment[0].i)}
            cy={y(segment[0].pct)}
            r={2}
            fill="currentColor"
          />
        ) : (
          <polyline
            key={segment[0].i}
            points={segment.map((p) => `${x(p.i)},${y(p.pct)}`).join(" ")}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      )}
    </svg>
  );
}
