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

export function Logo({
  className,
  href = "/",
  size = "md",
}: {
  className?: string;
  href?: string | null;
  size?: LogoSize;
  /** @deprecated Included in the logo asset. */
  withTagline?: boolean;
  /** @deprecated Included in the logo asset. */
  withMark?: boolean;
  /** @deprecated Logo asset has its own background. */
  onDark?: boolean;
}) {
  const s = SIZES[size];

  const lockup = (
    <Image
      src={LOGO_SRC}
      alt="cmeprep.me — Smarter prep. Better outcomes"
      width={LOGO_WIDTH}
      height={LOGO_HEIGHT}
      className={cn(s.className, "rounded-md object-contain", className)}
      sizes={`(max-width: 640px) ${s.height * 4}px, ${Math.round((s.height * LOGO_WIDTH) / LOGO_HEIGHT)}px`}
      priority={size === "lg"}
    />
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
