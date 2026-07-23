import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * Shown on the dashboard and profile when access ends within
 * EXPIRY_WARNING_DAYS. Links to /#pricing rather than a checkout page —
 * subscription rows only store a plan name snapshot, not a plan id.
 */
export function ExpiryBanner({
  periodEnd,
  daysLeft,
}: {
  periodEnd: string;
  daysLeft: number;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl bg-secondary px-4 py-3.5">
      <CalendarClock className="size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">
          Your plan access ends {dateFormatter.format(new Date(periodEnd))} —{" "}
          {daysLeft} {daysLeft === 1 ? "day" : "days"} left.
        </p>
        <p className="text-muted-foreground">
          Renew any time — your new period starts when the current one ends, so
          you won&apos;t lose a day.
        </p>
      </div>
      <Button size="sm" asChild>
        <Link href="/#pricing">Renew</Link>
      </Button>
    </div>
  );
}
