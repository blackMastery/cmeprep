import { Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The tutor's face: a stethoscope on the brand crimson, so every tutor turn
 * reads as "the doctor answering" and the student's own turns (plain
 * bubbles, no avatar) stay visually distinct. One component so the header,
 * transcript and marketing mockup can never drift apart.
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
        "flex shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground",
        size === "sm" ? "size-7" : "size-9",
        className,
      )}
      aria-hidden="true"
    >
      <Stethoscope className={size === "sm" ? "size-3.5" : "size-4.5"} />
    </span>
  );
}
