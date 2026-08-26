import { chartTicks, type DayPoint } from "@/lib/analytics-core";
import { cn } from "@/lib/utils";

/**
 * The dashboard's line/bar chart — the TrendSparkline idiom grown axes.
 * Server-rendered inline SVG, no client JS, no chart library: brand-token
 * strokes, null points break a line into segments (a gap is "no data", not
 * zero), and wide ranges stay legible because the x-axis only labels month
 * starts plus the endpoints.
 */

const TONE_CLASS = {
  crimson: "text-primary",
  teal: "text-teal-deep",
  sun: "text-sun",
  ink: "text-foreground",
} as const;

export type ChartTone = keyof typeof TONE_CLASS;

export type ChartSeries = {
  label: string;
  tone?: ChartTone;
  points: DayPoint[];
};

const WIDTH = 720;
const HEIGHT = 200;
const PAD_LEFT = 46;
const PAD_RIGHT = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 22;

function monthLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
}

function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function DailyChart({
  series,
  kind,
  formatValue = (v) => String(v),
  ariaLabel,
  className,
}: {
  series: ChartSeries[];
  /** "bar" supports exactly one series. */
  kind: "line" | "bar";
  /** Axis/legend value formatting — pass priceLabel-style helpers for cents. */
  formatValue?: (value: number) => string;
  ariaLabel: string;
  className?: string;
}) {
  const days = series[0]?.points.map((p) => p.day) ?? [];
  const n = days.length;
  const values = series
    .flatMap((s) => s.points.map((p) => p.value))
    .filter((v): v is number => v !== null);

  if (n === 0 || values.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No data in this range yet.
      </p>
    );
  }

  // Charts are 0-based; net revenue can dip negative on refund-heavy days.
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const ticks = chartTicks(max);
  const top = ticks[ticks.length - 1];
  const floor = min < 0 ? min : 0;
  const span = top - floor || 1;

  const innerW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const x = (i: number) =>
    n === 1 ? PAD_LEFT + innerW / 2 : PAD_LEFT + (i * innerW) / (n - 1);
  const y = (v: number) => PAD_TOP + innerH - ((v - floor) / span) * innerH;

  // Label month boundaries (plus both endpoints on short ranges) — every day
  // labelled becomes soup past 30 points.
  const xLabels = days
    .map((day, i) => ({ day, i }))
    .filter(
      ({ day, i }) =>
        i === 0 ||
        i === n - 1 ||
        (n > 14 ? day.endsWith("-01") : i % Math.ceil(n / 7) === 0)
    );

  const barW = Math.max(1.5, (innerW / n) * 0.7);

  return (
    <figure className={cn("overflow-x-auto", className)}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full min-w-120"
        role="img"
        aria-label={ariaLabel}
        fill="none"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={y(tick)}
              y2={y(tick)}
              stroke="currentColor"
              strokeWidth={tick === 0 ? 1 : 0.5}
              className={tick === 0 ? "text-border" : "text-border/60"}
            />
            <text
              x={PAD_LEFT - 6}
              y={y(tick) + 3}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}

        {xLabels.map(({ day, i }) => (
          <text
            key={day}
            x={x(i)}
            y={HEIGHT - 6}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            className="fill-muted-foreground text-[10px]"
          >
            {n > 14 && !(i === 0 || i === n - 1) ? monthLabel(day) : shortDay(day)}
          </text>
        ))}

        {kind === "bar"
          ? series[0].points.map(
              (p, i) =>
                p.value !== null &&
                p.value !== 0 && (
                  <rect
                    key={p.day}
                    x={x(i) - barW / 2}
                    y={Math.min(y(p.value), y(0))}
                    width={barW}
                    height={Math.abs(y(p.value) - y(0))}
                    rx={1}
                    fill="currentColor"
                    className={cn(
                      TONE_CLASS[series[0].tone ?? "teal"],
                      p.value < 0 && "text-destructive"
                    )}
                  >
                    <title>{`${shortDay(p.day)}: ${formatValue(p.value)}`}</title>
                  </rect>
                )
            )
          : series.map((s, si) => {
              // Consecutive non-null runs → polyline segments; lone points → dots.
              const segments: { i: number; v: number }[][] = [];
              let run: { i: number; v: number }[] = [];
              s.points.forEach((p, i) => {
                if (p.value === null) {
                  if (run.length > 0) segments.push(run);
                  run = [];
                } else {
                  run.push({ i, v: p.value });
                }
              });
              if (run.length > 0) segments.push(run);
              const tone =
                TONE_CLASS[
                  s.tone ??
                    (["teal", "crimson", "sun", "ink"] as const)[
                      si % 4
                    ]
                ];
              return segments.map((segment) =>
                segment.length === 1 ? (
                  <circle
                    key={`${s.label}-${segment[0].i}`}
                    cx={x(segment[0].i)}
                    cy={y(segment[0].v)}
                    r={2.5}
                    fill="currentColor"
                    className={tone}
                  />
                ) : (
                  <polyline
                    key={`${s.label}-${segment[0].i}`}
                    points={segment.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")}
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={tone}
                  />
                )
              );
            })}
      </svg>

      {kind === "line" && series.length > 1 && (
        <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {series.map((s, si) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-block h-0.5 w-4 rounded-full bg-current",
                  TONE_CLASS[
                    s.tone ?? (["teal", "crimson", "sun", "ink"] as const)[si % 4]
                  ]
                )}
                aria-hidden="true"
              />
              {s.label}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
