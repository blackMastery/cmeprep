import Link from "next/link";
import { Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";

type LogoSize = "sm" | "md" | "lg";

const SIZES: Record<
  LogoSize,
  { tile: string; icon: string; word: string; tagline: string; gap: string }
> = {
  sm: {
    tile: "size-7 rounded-lg",
    icon: "size-4",
    word: "text-base",
    tagline: "text-[0.45rem] tracking-[0.2em]",
    gap: "gap-2",
  },
  md: {
    tile: "size-10 rounded-xl",
    icon: "size-6",
    word: "text-2xl",
    tagline: "text-[0.55rem] tracking-[0.22em]",
    gap: "gap-2.5",
  },
  lg: {
    tile: "size-14 rounded-2xl",
    icon: "size-8",
    word: "text-4xl sm:text-5xl",
    tagline: "text-[0.7rem] tracking-[0.3em]",
    gap: "gap-4",
  },
};

/**
 * The cmeprep.me lockup: a stethoscope tile beside the wordmark.
 *
 * The wordmark's identity comes from its weight contrast — "cmeprep" bold,
 * ".me" light — set in the brand typeface (Poppins), not the body or display
 * faces. `onDark` switches it for the gradient hero and the ink footer.
 */
export function LogoMark({
  size = "md",
  className,
}: {
  size?: LogoSize;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-gradient-to-br from-[#ee7a55] to-[#bf4229] text-white shadow-[0_0_24px_-6px_rgba(232,93,66,0.75)]",
        s.tile,
        className
      )}
      aria-hidden="true"
    >
      <Stethoscope className={s.icon} strokeWidth={2} />
    </span>
  );
}

export function Logo({
  className,
  href = "/",
  size = "md",
  withTagline = false,
  withMark = true,
  onDark = false,
}: {
  className?: string;
  href?: string | null;
  size?: LogoSize;
  withTagline?: boolean;
  withMark?: boolean;
  onDark?: boolean;
}) {
  const s = SIZES[size];

  const lockup = (
    <span className={cn("inline-flex flex-col", className)}>
      <span className={cn("inline-flex items-center", s.gap)}>
        {withMark && <LogoMark size={size} />}

        <span
          className={cn(
            "font-brand leading-none tracking-tight",
            s.word,
            onDark ? "text-white" : "text-foreground"
          )}
        >
          <span className="font-bold">cmeprep</span>
          <span className="font-light">.me</span>
        </span>
      </span>

      {withTagline && (
        <span
          className={cn(
            "mt-2 font-brand font-light uppercase",
            s.tagline,
            onDark ? "text-[#f8d9bc]" : "text-muted-foreground"
          )}
        >
          Smarter prep . Better outcomes
        </span>
      )}
    </span>
  );

  if (href === null) return lockup;

  return (
    <Link
      href={href}
      aria-label="cmeprep.me home"
      className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      {lockup}
    </Link>
  );
}
