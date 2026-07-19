import { cn } from "@/lib/utils";

/**
 * The CME Prep heartbeat trace — P wave, QRS spike, T wave.
 * Drawn in a 120x32 viewBox, stroked with currentColor so it
 * inherits text color (crimson accents, muted dividers, etc.).
 */
export function EcgLine({
  className,
  animate = false,
  strokeWidth = 1.5,
}: {
  className?: string;
  animate?: boolean;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 120 32"
      fill="none"
      aria-hidden="true"
      className={cn("h-6 w-24 shrink-0", className)}
    >
      <path
        d="M0 16 L26 16 Q30 10 34 16 L44 16 L48 18.5 L53 3 L58 29 L62 11 L66 16 L82 16 Q88 8.5 94 16 L120 16"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={600}
        className={animate ? "ecg-animate [--ecg-length:600]" : undefined}
      />
    </svg>
  );
}

/**
 * Section divider: thin rules on both sides of a single beat.
 * Stays crisp at any container width (the beat never stretches).
 */
export function EcgDivider({
  className,
  lineClassName,
}: {
  className?: string;
  lineClassName?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex w-full items-center gap-0 text-border",
        className
      )}
    >
      <span className={cn("h-px flex-1 bg-current", lineClassName)} />
      <EcgLine className="h-8 w-28" />
      <span className={cn("h-px flex-1 bg-current", lineClassName)} />
    </div>
  );
}
