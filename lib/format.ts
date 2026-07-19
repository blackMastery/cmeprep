/**
 * Formatting helpers shared by Server and Client Components.
 *
 * Keep these out of any `"use client"` module: importing a value from a
 * client module into a Server Component turns it into a client reference,
 * and calling it server-side throws at render time.
 */

/** Seconds → `M:SS`, or `H:MM:SS` past an hour. */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
