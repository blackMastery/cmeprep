"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { EcgLine } from "@/components/brand/ecg-line";

const WARNING_SEC = 5 * 60;

/**
 * Counts down to the server's `expires_at`.
 *
 * `serverNow` is the server clock at render. The difference against the local
 * clock is measured inside the effect (never during render, where Date.now()
 * would be impure) so the displayed time matches what the server will actually
 * enforce on submit — a tampered device clock changes nothing.
 */
export function TestTimer({
  expiresAt,
  serverNow,
  onExpire,
}: {
  expiresAt: string;
  serverNow: string;
  onExpire: () => void;
}) {
  const deadline = new Date(expiresAt).getTime();

  // Seed from two server values, so the first paint already shows a correct
  // time instead of a placeholder — this is a timed exam and a blank clock
  // reads as broken. Pure (no Date.now()), so it is safe during render; the
  // effect below then keeps it live and skew-corrected.
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.floor((deadline - new Date(serverNow).getTime()) / 1000))
  );

  useEffect(() => {
    const skewMs = new Date(serverNow).getTime() - Date.now();

    const tick = () => {
      const next = Math.max(
        0,
        Math.floor((deadline - (Date.now() + skewMs)) / 1000)
      );
      setRemaining(next);
      if (next === 0) onExpire();
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [deadline, serverNow, onExpire]);

  const isWarning = remaining <= WARNING_SEC;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full px-3 py-1.5 tabular-nums transition-colors",
        isWarning
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-foreground"
      )}
      role="timer"
      aria-live={isWarning ? "polite" : "off"}
    >
      {isWarning ? (
        <EcgLine className="h-4 w-10 ecg-pulse" strokeWidth={2} />
      ) : (
        <Clock className="size-4" aria-hidden="true" />
      )}
      <span className="text-sm font-semibold">{formatDuration(remaining)}</span>
      <span className="sr-only">remaining</span>
    </div>
  );
}
