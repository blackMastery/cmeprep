import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

const LOGO_SRC = "/logo.jpg";
const LOGO_WIDTH = 1952;
const LOGO_HEIGHT = 528;

type LogoSize = "sm" | "md" | "lg";

const SIZES: Record<LogoSize, { height: number; className: string }> = {
  sm: { height: 28, className: "h-7 w-auto" },
  md: { height: 40, className: "h-10 w-auto" },
  lg: { height: 72, className: "h-16 w-auto sm:h-[4.5rem]" },
};

/**
 * The cmeprep.me lockup — brand mark, wordmark and tagline as a single asset.
 *
 * `withTagline`, `withMark` and `onDark` are kept for call-site compatibility;
 * the image already includes the mark and tagline on its own coral field.
 */
export function LogoMark({
  size = "md",
  className,
}: {
  size?: LogoSize;
  className?: string;
}) {
  // Crop to the left square of the banner (stethoscope tile).
  return (
    <span
      className={cn(
        "relative inline-block shrink-0 overflow-hidden",
        size === "sm" && "size-7 rounded-lg",
        size === "md" && "size-10 rounded-xl",
        size === "lg" && "size-14 rounded-2xl",
        className
      )}
      aria-hidden="true"
    >
      <Image
        src={LOGO_SRC}
        alt=""
        fill
        className="object-cover object-left"
        sizes="56px"
      />
    </span>
  );
}

/** Expansion of the CME acronym, shown as text so it stays crisp and themed. */
const TAGLINE = "Complete Medical Examinations Prep";

export function Logo({
  className,
  href = "/",
  size = "md",
  tagline,
  taglineClassName,
}: {
  className?: string;
  href?: string | null;
  size?: LogoSize;
  /**
   * Render "Complete Medical Examinations Prep" beside (`inline`, dropping
   * beneath the banner on phones) or beneath (`stacked`). Omit for the image
   * alone.
   */
  tagline?: "inline" | "stacked";
  taglineClassName?: string;
}) {
  const s = SIZES[size];

  const image = (
    <Image
      src={LOGO_SRC}
      alt="cmeprep.me — Smarter prep. Better outcomes"
      width={LOGO_WIDTH}
      height={LOGO_HEIGHT}
      className={cn(
        s.className,
        // Compact lockup on phones: smaller banner so the one-line tagline
        // beneath it keeps the inline header within its 64px height.
        tagline === "inline" && "max-sm:h-7",
        "rounded-md object-contain",
        className
      )}
      sizes={`(max-width: 640px) ${s.height * 4}px, ${Math.round((s.height * LOGO_WIDTH) / LOGO_HEIGHT)}px`}
      priority={size === "lg"}
    />
  );

  const lockup = tagline ? (
    <span
      className={cn(
        "inline-flex",
        tagline === "stacked"
          ? "flex-col items-center gap-2"
          : "flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:gap-0"
      )}
    >
      {image}
      <span
        className={cn(
          "font-medium uppercase text-muted-foreground",
          tagline === "inline" &&
            "text-[7px]/[1.3] tracking-[0.08em] whitespace-nowrap sm:ml-3 sm:max-w-44 sm:border-l sm:border-border sm:pl-3 sm:text-[10px]/[1.4] sm:tracking-[0.14em] sm:whitespace-normal",
          tagline === "stacked" &&
            "text-center text-[11px]/[1.4] tracking-[0.18em]",
          taglineClassName
        )}
      >
        {TAGLINE}
      </span>
    </span>
  ) : (
    image
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
