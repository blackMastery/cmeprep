/**
 * Pure parts of the reconciliation sweep: eligibility, the time budget, and the
 * shape of the summary. No `server-only` import so vitest can exercise them;
 * the DB and PayPal work lives in lib/reconcile.ts.
 *
 * Every tunable lives here so that changing the cadence is one file.
 */

/**
 * How old an unprocessed event must be before the sweep touches it.
 *
 * payment_events rows are inserted BEFORE the handler runs, so a delivery that
 * is executing right now has processed_at null and must not be replayed
 * underneath itself. Comfortably longer than the route's 60s ceiling.
 */
export const REPLAY_DELAY_MINUTES = 5;

/**
 * Poison-pill guard, and not optional. With `order by created_at asc` and a
 * batch cap, a handful of permanently-failing events (deleted plan, deleted
 * exam) would sit at the head of the queue forever and starve every newer event
 * behind them. Rows at the cap are quarantined and reported, not retried.
 */
export const MAX_REPLAY_ATTEMPTS = 5;

export const EVENT_BATCH = 50;
export const UNCLAIMED_BATCH = 50;

/**
 * Wall-clock budget, of the route's maxDuration 60. Batch caps alone are not
 * enough: 50 events routed through the order-approved handler means 50 PayPal
 * round trips. The remainder is headroom for the summary write and the response.
 */
export const BUDGET_MS = 45_000;

export type ReplayCandidate = {
  processedAt: string | null;
  replayAttempts: number;
  createdAt: string;
};

/** Whether the sweep may replay this event now. */
export function isReplayEligible(
  event: ReplayCandidate,
  now: Date,
  delayMinutes: number = REPLAY_DELAY_MINUTES,
  maxAttempts: number = MAX_REPLAY_ATTEMPTS
): boolean {
  if (event.processedAt !== null) return false;
  if (event.replayAttempts >= maxAttempts) return false;
  const age = now.getTime() - new Date(event.createdAt).getTime();
  return age >= delayMinutes * 60_000;
}

/** True while there is still time to start another item. */
export function hasBudget(deadline: number, now: number): boolean {
  return now < deadline;
}

export type PassResult = {
  scanned: number;
  repaired: number;
  failed: number;
  /** Gave up on: at the replay cap, awaiting a human. */
  quarantined: number;
};

export function emptyPass(): PassResult {
  return { scanned: 0, repaired: 0, failed: 0, quarantined: 0 };
}

export type SweepSummary = {
  durationMs: number;
  /** A pass stopped on the deadline; there is more outstanding work. */
  truncated: boolean;
  events: PassResult;
  unclaimedPayments: PassResult;
  /** Nothing outstanding and nothing went wrong. */
  clean: boolean;
};

export function summarizeSweep(input: {
  durationMs: number;
  truncated: boolean;
  events: PassResult;
  unclaimedPayments: PassResult;
}): SweepSummary {
  const passes = [input.events, input.unclaimedPayments];
  const clean =
    !input.truncated &&
    passes.every((p) => p.failed === 0 && p.quarantined === 0 && p.scanned === 0);

  return { ...input, clean };
}
