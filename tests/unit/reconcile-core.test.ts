import { describe, expect, it } from "vitest";
import {
  emptyPass,
  hasBudget,
  isReplayEligible,
  summarizeSweep,
  MAX_REPLAY_ATTEMPTS,
  type PassResult,
} from "@/lib/reconcile-core";

const NOW = new Date("2026-08-10T12:00:00.000Z");

const event = (over: Partial<Parameters<typeof isReplayEligible>[0]> = {}) => ({
  processedAt: null,
  replayAttempts: 0,
  // Twenty minutes old — well past the replay delay.
  createdAt: "2026-08-10T11:40:00.000Z",
  ...over,
});

const pass = (over: Partial<PassResult> = {}): PassResult => ({
  ...emptyPass(),
  ...over,
});

describe("isReplayEligible", () => {
  it("replays an event older than the replay delay", () => {
    expect(isReplayEligible(event(), NOW)).toBe(true);
  });

  it("skips events younger than the replay delay, which may still be in flight", () => {
    // payment_events is written BEFORE the handler runs, so a delivery
    // executing right now looks exactly like a failed one.
    expect(
      isReplayEligible(event({ createdAt: "2026-08-10T11:58:00.000Z" }), NOW)
    ).toBe(false);
  });

  it("skips events that have already been processed", () => {
    expect(
      isReplayEligible(event({ processedAt: "2026-08-10T11:41:00.000Z" }), NOW)
    ).toBe(false);
  });

  it("quarantines an event that has burned its replay attempts", () => {
    expect(
      isReplayEligible(event({ replayAttempts: MAX_REPLAY_ATTEMPTS }), NOW)
    ).toBe(false);
    expect(
      isReplayEligible(event({ replayAttempts: MAX_REPLAY_ATTEMPTS - 1 }), NOW)
    ).toBe(true);
  });
});

describe("hasBudget", () => {
  it("allows work while the deadline is in the future", () => {
    expect(hasBudget(1_000, 999)).toBe(true);
  });

  it("stops once the deadline has passed", () => {
    expect(hasBudget(1_000, 1_000)).toBe(false);
    expect(hasBudget(1_000, 1_001)).toBe(false);
  });
});

describe("summarizeSweep", () => {
  it("reports a clean run when nothing was outstanding", () => {
    const summary = summarizeSweep({
      durationMs: 120,
      truncated: false,
      events: pass(),
      unclaimedPayments: pass(),
    });
    expect(summary.clean).toBe(true);
  });

  it("is not clean when a pass repaired something", () => {
    // A repair means a delivery was lost. Worth a human's attention even though
    // the sweep fixed it.
    const summary = summarizeSweep({
      durationMs: 900,
      truncated: false,
      events: pass({ scanned: 1, repaired: 1 }),
      unclaimedPayments: pass(),
    });
    expect(summary.clean).toBe(false);
  });

  it("is not clean when a run stopped on the deadline", () => {
    const summary = summarizeSweep({
      durationMs: 45_000,
      truncated: true,
      events: pass(),
      unclaimedPayments: pass(),
    });
    expect(summary.clean).toBe(false);
  });

  it("counts quarantined events separately from failures", () => {
    const summary = summarizeSweep({
      durationMs: 500,
      truncated: false,
      events: pass({ scanned: 3, failed: 1, quarantined: 2 }),
      unclaimedPayments: pass(),
    });
    expect(summary.events.failed).toBe(1);
    expect(summary.events.quarantined).toBe(2);
    expect(summary.clean).toBe(false);
  });
});
