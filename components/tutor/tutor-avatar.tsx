import Image from "next/image";
import { cn } from "@/lib/utils";
import aitutor from "@/public/images/aitutor.png";

/**
 * The tutor's face, so every tutor turn reads as "the doctor answering" and
 * the student's own turns (plain bubbles, no avatar) stay visually distinct.
 * One component so the header, transcript and marketing mockup can never
 * drift apart.
 *
 * The source PNG is a rounded square with light corners around a green disc;
 * the circular clip plus a slight zoom crops to the disc so no corner shows.
 */
export function TutorAvatar({
  size = "md",
  className,
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 overflow-hidden rounded-full ring-1 ring-border",
        size === "sm" ? "size-7" : "size-9",
        className,
      )}
      aria-hidden="true"
    >
      <Image
        src={aitutor}
        alt=""
        sizes="36px"
        className="size-full scale-110 object-cover"
      />
    </span>
  );
}
