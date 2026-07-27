import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * Shown on the dashboard and profile when access to ONE exam ends within
 * EXPIRY_WARNING_DAYS. Access is per exam, so a student can see two of these
 * at once with different dates.
 */
export function ExpiryBanner({
  periodEnd,
  daysLeft,
  examName,
  renewHref,
}: {
  periodEnd: string;
  daysLeft: number;
  /** null for an all-access row, which covers everything. */
  examName: string | null;
  renewHref: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl bg-secondary px-4 py-3.5">
      <CalendarClock className="size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">
          Your access to {examName ? <strong>{examName}</strong> : "all exams"}{" "}
          ends {dateFormatter.format(new Date(periodEnd))} — {daysLeft}{" "}
          {daysLeft === 1 ? "day" : "days"} left.
        </p>
        <p className="text-muted-foreground">
          Renew any time — your new period starts when the current one ends, so
          you won&apos;t lose a day.
        </p>
      </div>
      <Button size="sm" asChild>
        <Link href={renewHref}>Renew</Link>
      </Button>
    </div>
  );
}
