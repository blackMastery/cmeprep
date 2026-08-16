import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import {
  addDays,
  aggregateEngagementDay,
  aggregateGross,
  analyticsDay,
  fillDays,
  guyanaDayBounds,
  questionQuality,
  rangeStartFor,
  refundDeltas,
  rollingActive,
  rollupTargetDays,
  subjectCoverage,
  sumByCurrency,
  NONE_KEY,
  ROLLUP_BUDGET_MS,
  ROLLUP_PAGE,
  TEST_LOOKBACK_DAYS,
  type AttemptForRollup,
  type CoverageRow,
  type CurrencyTotal,
  type DayPoint,
  type PaymentForRollup,
  type RangePreset,
  type RevenueCsvRow,
  type TestForRollup,
} from "@/lib/analytics-core";
import { hasBudget, MAX_REPLAY_ATTEMPTS } from "@/lib/reconcile-core";
import type {
  AnalyticsDailyEngagement,
  AnalyticsDailyExamActivity,
  AnalyticsDailyRefund,
  AnalyticsDailyRevenue,
  AnalyticsQuestionStat,
  ReconcileRun,
  TestMode,
} from "@/lib/supabase/types";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * The DB side of the admin business dashboard. Writers (the nightly rollup +
 * the one-time backfill) live at the top, dashboard readers below. Every
 * derivation rule is in lib/analytics-core.ts; this file only moves rows.
 *
 * Like the reconcile sweep, the rollup is CATCH-UP shaped: gross and
 * engagement recompute whole days (idempotent by construction), and refunds
 * are watermarked per payment (idempotent by the analytics_book_refund RPC),
 * so a dropped or truncated run self-heals on the next one.
 */

const MARKS_CHUNK = 200;
const INSERT_CHUNK = 500;

/** `.in()` lists and bulk inserts, kept under PostgREST's URL/body comfort. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type Page<T> = { data: T[] | null; error: { message: string } | null };

/** Drain a query page by page — PostgREST caps un-ranged selects at 1000.
 * The builder is a thenable rather than a Promise, hence PromiseLike. */
async function pageAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<Page<T>>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += ROLLUP_PAGE) {
    const { data, error } = await fetchPage(from, from + ROLLUP_PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < ROLLUP_PAGE) return rows;
  }
}

/* ── writers ───────────────────────────────────────────────── */

export type RollupSummary = {
  durationMs: number;
  truncated: boolean;
  daysRolled: string[];
  daysFailed: string[];
  refundsBooked: number;
  refundCentsBooked: number;
  questionStatsRefreshed: boolean;
};

export async function runNightlyRollup(options?: {
  budgetMs?: number;
}): Promise<RollupSummary> {
  const startedAt = Date.now();
  const deadline = startedAt + (options?.budgetMs ?? ROLLUP_BUDGET_MS);
  const now = new Date();
  const admin = createAdminClient();

  const daysRolled: string[] = [];
  const daysFailed: string[] = [];
  for (const day of rollupTargetDays(now)) {
    if (!hasBudget(deadline, Date.now())) break;
    try {
      await rollupRevenueDay(admin, day);
      await rollupEngagementDay(admin, day, now);
      daysRolled.push(day);
    } catch (error) {
      // One bad day never aborts the run — it re-rolls tomorrow anyway.
      daysFailed.push(day);
      console.error("analytics_rollup_day_failed", { day, error });
    }
  }

  let refundsBooked = 0;
  let refundCentsBooked = 0;
  try {
    const booked = await bookOutstandingRefunds(admin, analyticsDay(now), deadline);
    refundsBooked = booked.count;
    refundCentsBooked = booked.cents;
  } catch (error) {
    console.error("analytics_refund_pass_failed", { error });
  }

  let questionStatsRefreshed = false;
  if (hasBudget(deadline, Date.now())) {
    const { error } = await admin.rpc("analytics_recompute_question_stats");
    if (error) console.error("analytics_question_stats_failed", { error });
    else questionStatsRefreshed = true;
  }

  const summary: RollupSummary = {
    durationMs: Date.now() - startedAt,
    truncated: !hasBudget(deadline, Date.now()),
    daysRolled,
    daysFailed,
    refundsBooked,
    refundCentsBooked,
    questionStatsRefreshed,
  };

  await writeState(admin, "last_nightly", { ...summary, ranAt: now.toISOString() });
  // Heartbeat, like payment.reconcile: written every run so a dead cron is
  // visible as a stale audit trail.
  await audit(null, "analytics.rollup", null, { ...summary });

  return summary;
}

export type BackfillSummary = {
  durationMs: number;
  done: boolean;
  /** Next day the backfill will process; meaningless once done. */
  cursor: string | null;
  daysProcessed: number;
};

/**
 * One-time history load, invoked repeatedly (each call is budget-bound) until
 * done. Idempotent: gross/engagement recompute identically, and historical
 * refunds book against the CAPTURE day through the same watermarked RPC, so
 * re-running a day is a no-op and the nightly refund pass skips them forever
 * after.
 */
export async function runAnalyticsBackfill(options?: {
  budgetMs?: number;
}): Promise<BackfillSummary> {
  const startedAt = Date.now();
  const deadline = startedAt + (options?.budgetMs ?? ROLLUP_BUDGET_MS);
  const now = new Date();
  const admin = createAdminClient();
  // Only closed days: the current day rolls up tonight.
  const lastClosedDay = addDays(analyticsDay(now), -1);

  let cursor = await readBackfillCursor(admin);
  if (cursor === null) {
    cursor = await earliestActivityDay(admin);
    if (cursor === null) {
      // Nothing to backfill — brand-new database.
      await writeState(admin, "backfill", { cursor: lastClosedDay, done: true });
      return { durationMs: Date.now() - startedAt, done: true, cursor: null, daysProcessed: 0 };
    }
  }

  let daysProcessed = 0;
  while (cursor <= lastClosedDay && hasBudget(deadline, Date.now())) {
    await rollupRevenueDay(admin, cursor);
    await backfillRefundsForDay(admin, cursor);
    await rollupEngagementDay(admin, cursor, now);
    daysProcessed += 1;
    cursor = addDays(cursor, 1);
    await writeState(admin, "backfill", { cursor, done: false });
  }

  const done = cursor > lastClosedDay;
  if (done) {
    const { error } = await admin.rpc("analytics_recompute_question_stats");
    if (error) console.error("analytics_question_stats_failed", { error });
    await writeState(admin, "backfill", { cursor, done: true });
  }

  const summary: BackfillSummary = {
    durationMs: Date.now() - startedAt,
    done,
    cursor: done ? null : cursor,
    daysProcessed,
  };
  await audit(null, "analytics.backfill", null, { ...summary });
  return summary;
}

const PAYMENT_ROLLUP_COLS =
  "id, exam_id, plan_name, org_id, source, currency, amount_cents, refunded_cents, status";

async function fetchDayPayments(
  admin: AdminClient,
  day: string
): Promise<PaymentForRollup[]> {
  const { fromIso, toIso } = guyanaDayBounds(day);
  return pageAll((from, to) =>
    admin
      .from("payments")
      .select(PAYMENT_ROLLUP_COLS)
      .gte("captured_at", fromIso)
      .lt("captured_at", toIso)
      .order("captured_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
}

/** Recompute one capture day's gross rows: delete + insert, always safe. */
async function rollupRevenueDay(admin: AdminClient, day: string): Promise<void> {
  const payments = await fetchDayPayments(admin, day);
  const rows = aggregateGross(payments, day);

  const del = await admin.from("analytics_daily_revenue").delete().eq("day", day);
  if (del.error) throw new Error(del.error.message);
  if (rows.length === 0) return;

  const ins = await admin.from("analytics_daily_revenue").insert(
    rows.map((r) => ({
      day: r.day,
      exam_key: r.examKey,
      plan_key: r.planKey,
      channel: r.channel,
      source: r.source,
      currency: r.currency,
      payments_count: r.paymentsCount,
      gross_cents: r.grossCents,
      null_amounts: r.nullAmounts,
    }))
  );
  if (ins.error) throw new Error(ins.error.message);
}

async function fetchMarks(
  admin: AdminClient,
  paymentIds: readonly string[]
): Promise<Map<string, number>> {
  const marks = new Map<string, number>();
  for (const ids of chunk(paymentIds, MARKS_CHUNK)) {
    const { data, error } = await admin
      .from("analytics_refund_marks")
      .select("payment_id, booked_refunded_cents")
      .in("payment_id", ids);
    if (error) throw new Error(error.message);
    for (const m of data ?? []) marks.set(m.payment_id, m.booked_refunded_cents);
  }
  return marks;
}

async function bookDeltas(
  admin: AdminClient,
  payments: readonly PaymentForRollup[],
  bookDay: string
): Promise<{ count: number; cents: number }> {
  const marks = await fetchMarks(
    admin,
    payments.map((p) => p.id)
  );
  let count = 0;
  let cents = 0;
  for (const delta of refundDeltas(payments, marks)) {
    const { error } = await admin.rpc("analytics_book_refund", {
      p_payment_id: delta.paymentId,
      p_day: bookDay,
      p_exam_key: delta.key.examKey,
      p_plan_key: delta.key.planKey,
      p_channel: delta.key.channel,
      p_source: delta.key.source,
      p_currency: delta.key.currency,
      p_delta_cents: delta.deltaCents,
      p_new_booked_cents: delta.newBookedCents,
    });
    if (error) throw new Error(error.message);
    count += 1;
    cents += delta.deltaCents;
  }
  return { count, cents };
}

/**
 * The nightly refund pass. Deliberately NOT day-scoped (the reconcile sweep's
 * "no watermark on the scan, watermark on the work" philosophy): it scans
 * every payment with money handed back and books whatever the marks say is
 * still unbooked — onto TODAY, the day the delta was observed.
 */
async function bookOutstandingRefunds(
  admin: AdminClient,
  bookDay: string,
  deadline: number
): Promise<{ count: number; cents: number }> {
  const refunded = await pageAll<PaymentForRollup>((from, to) =>
    admin
      .from("payments")
      .select(PAYMENT_ROLLUP_COLS)
      .or("refunded_cents.gt.0,status.eq.reversed")
      .order("captured_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  let count = 0;
  let cents = 0;
  for (const page of chunk(refunded, MARKS_CHUNK)) {
    if (!hasBudget(deadline, Date.now())) break;
    const booked = await bookDeltas(admin, page, bookDay);
    count += booked.count;
    cents += booked.cents;
  }
  return { count, cents };
}

/**
 * Backfill's refund handling: pre-launch refunds have no observable date (the
 * running total is not a log), so they book in full against the CAPTURE day —
 * the accepted one-time distortion from the plan.
 */
async function backfillRefundsForDay(
  admin: AdminClient,
  day: string
): Promise<void> {
  const payments = await fetchDayPayments(admin, day);
  const refunded = payments.filter(
    (p) => p.refunded_cents > 0 || p.status === "reversed"
  );
  if (refunded.length > 0) await bookDeltas(admin, refunded, day);
}

/** Recompute one day's engagement rows (active users, counters, per-exam). */
async function rollupEngagementDay(
  admin: AdminClient,
  day: string,
  now: Date
): Promise<void> {
  const { fromIso, toIso } = guyanaDayBounds(day);

  const attemptRows = await pageAll((from, to) =>
    admin
      .from("attempts")
      .select(
        "user_id, is_correct, answered_at, tests(mode), questions(subjects(specialties(exam_id)))"
      )
      .gte("answered_at", fromIso)
      .lt("answered_at", toIso)
      .order("answered_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  const attempts: AttemptForRollup[] = (
    attemptRows as unknown as {
      user_id: string;
      is_correct: boolean;
      answered_at: string;
      tests: { mode: TestMode } | null;
      questions: { subjects: { specialties: { exam_id: string } | null } | null } | null;
    }[]
  ).map((a) => ({
    user_id: a.user_id,
    is_correct: a.is_correct,
    answered_at: a.answered_at,
    mode: a.tests?.mode ?? null,
    exam_id: a.questions?.subjects?.specialties?.exam_id ?? null,
  }));

  // Every test that could have started, submitted or expired inside the day.
  // Bounded by started_at (the only indexed column that always precedes the
  // other two); TEST_LOOKBACK_DAYS is the accepted horizon for late submits.
  const lookbackFrom = guyanaDayBounds(addDays(day, -TEST_LOOKBACK_DAYS)).fromIso;
  const tests = await pageAll<TestForRollup>((from, to) =>
    admin
      .from("tests")
      .select("status, mode, started_at, submitted_at, expires_at")
      .gte("started_at", lookbackFrom)
      .lt("started_at", toIso)
      .order("started_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );

  const { engagement, activeUserIds, examActivity } = aggregateEngagementDay(
    day,
    attempts,
    tests,
    now
  );

  const delUsers = await admin
    .from("analytics_active_user_days")
    .delete()
    .eq("day", day);
  if (delUsers.error) throw new Error(delUsers.error.message);
  for (const ids of chunk(activeUserIds, INSERT_CHUNK)) {
    const { error } = await admin
      .from("analytics_active_user_days")
      .insert(ids.map((user_id) => ({ day, user_id })));
    if (error) throw new Error(error.message);
  }

  // WAU/MAU from the rollup rows just written (plus the 29 days before them).
  const windowRows = await pageAll((from, to) =>
    admin
      .from("analytics_active_user_days")
      .select("day, user_id")
      .gte("day", addDays(day, -29))
      .lte("day", day)
      .order("day", { ascending: true })
      .order("user_id", { ascending: true })
      .range(from, to)
  );
  const { wau, mau } = rollingActive(windowRows, day);

  const upsert = await admin.from("analytics_daily_engagement").upsert(
    {
      day,
      dau: engagement.dau,
      wau,
      mau,
      tests_started_exam: engagement.testsStartedExam,
      tests_started_tutor: engagement.testsStartedTutor,
      tests_submitted_exam: engagement.testsSubmittedExam,
      tests_submitted_tutor: engagement.testsSubmittedTutor,
      tests_ended_exam: engagement.testsEndedExam,
      tests_ended_tutor: engagement.testsEndedTutor,
      attempts_count: engagement.attemptsCount,
      correct_count: engagement.correctCount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "day" }
  );
  if (upsert.error) throw new Error(upsert.error.message);

  const delExam = await admin
    .from("analytics_daily_exam_activity")
    .delete()
    .eq("day", day);
  if (delExam.error) throw new Error(delExam.error.message);
  if (examActivity.length > 0) {
    const { error } = await admin.from("analytics_daily_exam_activity").insert(
      examActivity.map((r) => ({
        day: r.day,
        exam_key: r.examKey,
        attempts: r.attempts,
        correct: r.correct,
      }))
    );
    if (error) throw new Error(error.message);
  }
}

async function writeState(
  admin: AdminClient,
  key: string,
  value: Record<string, unknown>
): Promise<void> {
  const { error } = await admin
    .from("analytics_state")
    .upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  if (error) console.error("analytics_state_write_failed", { key, error });
}

async function readBackfillCursor(admin: AdminClient): Promise<string | null> {
  const { data } = await admin
    .from("analytics_state")
    .select("value")
    .eq("key", "backfill")
    .maybeSingle();
  const cursor = (data?.value as { cursor?: unknown } | null)?.cursor;
  return typeof cursor === "string" ? cursor : null;
}

/** Guyana day of the first payment or attempt — where the backfill starts. */
async function earliestActivityDay(admin: AdminClient): Promise<string | null> {
  const [payment, attempt] = await Promise.all([
    admin
      .from("payments")
      .select("captured_at")
      .order("captured_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin
      .from("attempts")
      .select("answered_at")
      .order("answered_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  const instants = [payment.data?.captured_at, attempt.data?.answered_at]
    .filter((v): v is string => typeof v === "string")
    .map((iso) => analyticsDay(new Date(iso)));
  if (instants.length === 0) return null;
  return instants.sort()[0];
}

/* ── readers ───────────────────────────────────────────────── */

/** How the dashboard labels the NONE_KEY buckets. */
export const NONE_EXAM_LABEL = "All-access / unresolved";

export type BreakdownRow = {
  key: string;
  label: string;
  paymentsCount: number;
  grossCents: number;
  refundCents: number;
  netCents: number;
  currency: string;
};

export type RevenueSection = {
  from: string;
  to: string;
  totals: CurrencyTotal[];
  /** Net cents per day, gaps as 0 — the bar chart. Leading currency only. */
  netByDay: DayPoint[];
  chartCurrency: string | null;
  byExam: BreakdownRow[];
  byPlan: BreakdownRow[];
  byChannelSource: BreakdownRow[];
  hasRollups: boolean;
};

async function fetchRevenueRows(
  admin: AdminClient,
  start: string | null,
  examId: string | null
): Promise<{ gross: AnalyticsDailyRevenue[]; refunds: AnalyticsDailyRefund[] }> {
  const [gross, refunds] = await Promise.all([
    pageAll<AnalyticsDailyRevenue>((from, to) => {
      let q = admin.from("analytics_daily_revenue").select("*");
      if (start !== null) q = q.gte("day", start);
      if (examId !== null) q = q.eq("exam_key", examId);
      return q.order("day", { ascending: true }).range(from, to);
    }),
    pageAll<AnalyticsDailyRefund>((from, to) => {
      let q = admin.from("analytics_daily_refunds").select("*");
      if (start !== null) q = q.gte("day", start);
      if (examId !== null) q = q.eq("exam_key", examId);
      return q.order("day", { ascending: true }).range(from, to);
    }),
  ]);
  return { gross, refunds };
}

function breakdown(
  gross: readonly AnalyticsDailyRevenue[],
  refunds: readonly AnalyticsDailyRefund[],
  keyOf: (row: { exam_key: string; plan_key: string; channel: string; source: string }) => string,
  labelOf: (key: string) => string
): BreakdownRow[] {
  const rows = new Map<string, BreakdownRow>();
  const of = (key: string, currency: string): BreakdownRow => {
    // Currency is part of the identity so mixed-currency rows never sum.
    const id = `${key} ${currency}`;
    const row =
      rows.get(id) ??
      {
        key,
        label: labelOf(key),
        paymentsCount: 0,
        grossCents: 0,
        refundCents: 0,
        netCents: 0,
        currency,
      };
    rows.set(id, row);
    return row;
  };
  for (const g of gross) {
    const row = of(keyOf(g), g.currency);
    row.paymentsCount += g.payments_count;
    row.grossCents += g.gross_cents;
  }
  for (const r of refunds) of(keyOf(r), r.currency).refundCents += r.refund_cents;
  for (const row of rows.values()) row.netCents = row.grossCents - row.refundCents;
  return [...rows.values()].sort((a, b) => b.netCents - a.netCents);
}

export async function getRevenueSection(
  range: RangePreset,
  examId: string | null
): Promise<RevenueSection> {
  const admin = createAdminClient();
  const today = analyticsDay(new Date());
  const start = rangeStartFor(range, today);
  const { gross, refunds } = await fetchRevenueRows(admin, start, examId);

  const examIds = [
    ...new Set(
      [...gross, ...refunds].map((r) => r.exam_key).filter((k) => k !== NONE_KEY)
    ),
  ];
  const examNames = await examNamesById(admin, examIds);
  const examLabel = (key: string): string =>
    key === NONE_KEY ? NONE_EXAM_LABEL : (examNames.get(key) ?? key);

  const totals = sumByCurrency(gross, refunds);
  // The daily chart plots ONE currency (the largest by gross — USD in
  // practice); other currencies appear in the totals and tables only.
  const chartCurrency = totals[0]?.currency ?? null;
  const chartFrom =
    start ?? [...gross, ...refunds].map((r) => r.day).sort()[0] ?? today;
  const chartGross = gross.filter((g) => g.currency === chartCurrency);
  const chartRefunds = refunds.filter((r) => r.currency === chartCurrency);
  const grossByDay = fillDays(chartFrom, today, chartGross, (r) => r.gross_cents, 0);
  const refundsByDay = fillDays(chartFrom, today, chartRefunds, (r) => r.refund_cents, 0);
  const netByDay = grossByDay.map((p, i) => ({
    day: p.day,
    value: (p.value ?? 0) - (refundsByDay[i].value ?? 0),
  }));

  return {
    from: chartFrom,
    to: today,
    totals,
    netByDay,
    chartCurrency,
    byExam: breakdown(gross, refunds, (r) => r.exam_key, examLabel),
    byPlan: breakdown(gross, refunds, (r) => r.plan_key, (k) => k),
    byChannelSource: breakdown(
      gross,
      refunds,
      (r) => `${r.channel} · ${r.source}`,
      (k) => k
    ),
    hasRollups: gross.length > 0 || refunds.length > 0,
  };
}

export type EngagementSection = {
  from: string;
  to: string;
  /** Latest closed day's rollup — the WAU/MAU/DAU headline numbers. */
  latest: AnalyticsDailyEngagement | null;
  dauByDay: DayPoint[];
  rangeTotals: {
    startedExam: number;
    startedTutor: number;
    submittedExam: number;
    submittedTutor: number;
    endedExam: number;
    endedTutor: number;
    attempts: number;
    correct: number;
  };
  /** Accuracy % per day per exam (top exams by attempts), for the line chart. */
  accuracySeries: { examKey: string; label: string; points: DayPoint[] }[];
  hasRollups: boolean;
};

/** Accuracy chart caps at this many exam lines — more is unreadable. */
const ACCURACY_SERIES_CAP = 4;

export async function getEngagementSection(
  range: RangePreset,
  examId: string | null
): Promise<EngagementSection> {
  const admin = createAdminClient();
  const today = analyticsDay(new Date());
  const start = rangeStartFor(range, today);

  const engagementRows = await pageAll<AnalyticsDailyEngagement>((from, to) => {
    let q = admin.from("analytics_daily_engagement").select("*");
    if (start !== null) q = q.gte("day", start);
    return q.order("day", { ascending: true }).range(from, to);
  });

  const examRows = await pageAll<
    Pick<AnalyticsDailyExamActivity, "day" | "exam_key" | "attempts" | "correct">
  >((from, to) => {
    let q = admin
      .from("analytics_daily_exam_activity")
      .select("day, exam_key, attempts, correct");
    if (start !== null) q = q.gte("day", start);
    if (examId !== null) q = q.eq("exam_key", examId);
    return q.order("day", { ascending: true }).range(from, to);
  });

  const chartFrom = start ?? engagementRows[0]?.day ?? today;
  const dauByDay = fillDays(chartFrom, today, engagementRows, (r) => r.dau, 0);
  // Today has no rollup row by design (live cards cover it) — show a gap, not
  // a zero cliff.
  if (dauByDay.length > 0) {
    const last = dauByDay[dauByDay.length - 1];
    if (last.day === today && !engagementRows.some((r) => r.day === today)) {
      last.value = null;
    }
  }

  const rangeTotals = engagementRows.reduce(
    (acc, r) => ({
      startedExam: acc.startedExam + r.tests_started_exam,
      startedTutor: acc.startedTutor + r.tests_started_tutor,
      submittedExam: acc.submittedExam + r.tests_submitted_exam,
      submittedTutor: acc.submittedTutor + r.tests_submitted_tutor,
      endedExam: acc.endedExam + r.tests_ended_exam,
      endedTutor: acc.endedTutor + r.tests_ended_tutor,
      attempts: acc.attempts + r.attempts_count,
      correct: acc.correct + r.correct_count,
    }),
    {
      startedExam: 0,
      startedTutor: 0,
      submittedExam: 0,
      submittedTutor: 0,
      endedExam: 0,
      endedTutor: 0,
      attempts: 0,
      correct: 0,
    }
  );

  // Top exams by range attempts, one accuracy line each.
  const attemptsByExam = new Map<string, number>();
  for (const r of examRows) {
    attemptsByExam.set(r.exam_key, (attemptsByExam.get(r.exam_key) ?? 0) + r.attempts);
  }
  const topExams = [...attemptsByExam.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, ACCURACY_SERIES_CAP)
    .map(([key]) => key);
  const examNames = await examNamesById(
    admin,
    topExams.filter((k) => k !== NONE_KEY)
  );
  const accuracySeries = topExams.map((examKey) => ({
    examKey,
    label: examKey === NONE_KEY ? NONE_EXAM_LABEL : (examNames.get(examKey) ?? examKey),
    points: fillDays(
      chartFrom,
      today,
      examRows.filter((r) => r.exam_key === examKey),
      (r) => (r.attempts === 0 ? null : Math.round((r.correct / r.attempts) * 100))
    ),
  }));

  return {
    from: chartFrom,
    to: today,
    latest: engagementRows.at(-1) ?? null,
    dauByDay,
    rangeTotals,
    accuracySeries,
    hasRollups: engagementRows.length > 0,
  };
}

export type QuestionQualityRow = AnalyticsQuestionStat & {
  stem: string | null;
  subjectName: string | null;
};

export type ContentQualitySection = {
  hardest: QuestionQualityRow[];
  suspiciouslyEasy: QuestionQualityRow[];
  cold: QuestionQualityRow[];
  coldTotal: number;
  coverage: (CoverageRow & { examName: string })[];
  computedAt: string | null;
};

export async function getContentQualitySection(
  examId: string | null
): Promise<ContentQualitySection> {
  const admin = createAdminClient();

  const stats = await pageAll<AnalyticsQuestionStat>((from, to) => {
    let q = admin.from("analytics_question_stats").select("*");
    if (examId !== null) q = q.eq("exam_id", examId);
    return q.order("question_id", { ascending: true }).range(from, to);
  });

  const quality = questionQuality(stats);

  // Roster of every subject (per exam) with published question counts —
  // untouched subjects must appear in coverage.
  let rosterQuery = admin
    .from("exam_subject_counts")
    .select("exam_id, subject_id, subject_name, question_count");
  if (examId !== null) rosterQuery = rosterQuery.eq("exam_id", examId);
  const { data: rosterRows, error: rosterError } = await rosterQuery;
  if (rosterError) throw new Error(rosterError.message);

  const examIds = [...new Set((rosterRows ?? []).map((r) => r.exam_id))];
  const examNames = await examNamesById(admin, examIds);
  const coverage = subjectCoverage(
    (rosterRows ?? []).map((r) => ({
      subjectId: r.subject_id,
      subjectName: r.subject_name,
      questionCount: r.question_count,
    })),
    stats
  ).map((row) => {
    const rosterRow = (rosterRows ?? []).find((r) => r.subject_id === row.subjectId);
    return {
      ...row,
      examName: examNames.get(rosterRow?.exam_id ?? "") ?? "",
    };
  });

  // Stems + subject names for the three lists only — never all questions.
  const listIds = [
    ...new Set(
      [...quality.hardest, ...quality.suspiciouslyEasy, ...quality.cold].map(
        (s) => s.question_id
      )
    ),
  ];
  const stems = new Map<string, { stem: string; subjectName: string | null }>();
  for (const ids of chunk(listIds, MARKS_CHUNK)) {
    const { data, error } = await admin
      .from("questions")
      .select("id, stem, subjects(name)")
      .in("id", ids);
    if (error) throw new Error(error.message);
    for (const q of (data ?? []) as unknown as {
      id: string;
      stem: string;
      subjects: { name: string } | null;
    }[]) {
      stems.set(q.id, { stem: q.stem, subjectName: q.subjects?.name ?? null });
    }
  }
  const withStem = (s: AnalyticsQuestionStat): QuestionQualityRow => ({
    ...s,
    stem: stems.get(s.question_id)?.stem ?? null,
    subjectName: stems.get(s.question_id)?.subjectName ?? null,
  });

  return {
    hardest: quality.hardest.map(withStem),
    suspiciouslyEasy: quality.suspiciouslyEasy.map(withStem),
    cold: quality.cold.map(withStem),
    coldTotal: quality.coldTotal,
    coverage,
    computedAt: stats[0]?.computed_at ?? null,
  };
}

export type OpsHealth = {
  /** Money captured with no grant — count and per-currency cents. */
  unclaimed: { count: number; totals: { currency: string; cents: number }[]; oldestCapturedAt: string | null };
  webhookBacklog: { count: number; quarantined: number };
  reconcile: {
    latest: ReconcileRun | null;
    /** True when the 15-minute sweep has not reported in over 2 hours. */
    stale: boolean;
  };
  rollup: { lastNightly: Record<string, unknown> | null };
};

const RECONCILE_STALE_MS = 2 * 60 * 60 * 1000;

export async function getOpsHealth(): Promise<OpsHealth> {
  const admin = createAdminClient();

  const [unclaimedRows, backlog, quarantined, latestRun, lastNightly] =
    await Promise.all([
      // Expected empty; cap high enough that the sum stays honest while the
      // count below never lies.
      admin
        .from("payments")
        .select("amount_cents, refunded_cents, currency, captured_at", {
          count: "exact",
        })
        .is("subscription_id", null)
        .is("org_subscription_id", null)
        .in("status", ["captured", "partially_refunded"])
        .order("captured_at", { ascending: true })
        .limit(100),
      admin
        .from("payment_events")
        .select("id", { count: "exact", head: true })
        .is("processed_at", null),
      admin
        .from("payment_events")
        .select("id", { count: "exact", head: true })
        .is("processed_at", null)
        .gte("replay_attempts", MAX_REPLAY_ATTEMPTS),
      admin
        .from("reconcile_runs")
        .select("*")
        .order("ran_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("analytics_state")
        .select("value")
        .eq("key", "last_nightly")
        .maybeSingle(),
    ]);

  const byCurrency = new Map<string, number>();
  for (const p of unclaimedRows.data ?? []) {
    const currency = p.currency ?? "unknown";
    byCurrency.set(
      currency,
      (byCurrency.get(currency) ?? 0) +
        Math.max(0, (p.amount_cents ?? 0) - p.refunded_cents)
    );
  }

  const latest = latestRun.data ?? null;
  return {
    unclaimed: {
      count: unclaimedRows.count ?? 0,
      totals: [...byCurrency.entries()].map(([currency, cents]) => ({
        currency,
        cents,
      })),
      oldestCapturedAt: unclaimedRows.data?.[0]?.captured_at ?? null,
    },
    webhookBacklog: {
      count: backlog.count ?? 0,
      quarantined: quarantined.count ?? 0,
    },
    reconcile: {
      latest,
      stale:
        latest === null ||
        Date.now() - new Date(latest.ran_at).getTime() > RECONCILE_STALE_MS,
    },
    rollup: {
      lastNightly: (lastNightly.data?.value as Record<string, unknown>) ?? null,
    },
  };
}

export type TodayLive = {
  day: string;
  /** Gross captured today (live) minus refunds BOOKED today (rollup rows). */
  revenue: CurrencyTotal[];
  dau: number;
  attempts: number;
  testsStarted: number;
  testsSubmitted: number;
};

/**
 * The live "today" cards. Cheap on purpose: every query is bounded to one
 * civil day and rides the captured_at / answered_at / started_at indexes.
 */
export async function getTodayLive(): Promise<TodayLive> {
  const admin = createAdminClient();
  const day = analyticsDay(new Date());
  const { fromIso, toIso } = guyanaDayBounds(day);

  const [payments, todayRefunds, dauRows, attemptsCount, started, submitted] =
    await Promise.all([
      fetchDayPayments(admin, day),
      admin
        .from("analytics_daily_refunds")
        .select("currency, refund_cents")
        .eq("day", day),
      pageAll<{ user_id: string }>((from, to) =>
        admin
          .from("attempts")
          .select("user_id")
          .gte("answered_at", fromIso)
          .lt("answered_at", toIso)
          .order("id", { ascending: true })
          .range(from, to)
      ),
      admin
        .from("attempts")
        .select("id", { count: "exact", head: true })
        .gte("answered_at", fromIso)
        .lt("answered_at", toIso),
      admin
        .from("tests")
        .select("id", { count: "exact", head: true })
        .gte("started_at", fromIso)
        .lt("started_at", toIso),
      admin
        .from("tests")
        .select("id", { count: "exact", head: true })
        .gte("submitted_at", fromIso)
        .lt("submitted_at", toIso),
    ]);

  const gross = aggregateGross(payments, day);
  const revenue = sumByCurrency(
    gross.map((g) => ({
      currency: g.currency,
      payments_count: g.paymentsCount,
      gross_cents: g.grossCents,
      null_amounts: g.nullAmounts,
    })),
    (todayRefunds.data ?? []).map((r) => ({
      currency: r.currency,
      refund_cents: r.refund_cents,
    }))
  );

  return {
    day,
    revenue,
    dau: new Set(dauRows.map((r) => r.user_id)).size,
    attempts: attemptsCount.count ?? 0,
    testsStarted: started.count ?? 0,
    testsSubmitted: submitted.count ?? 0,
  };
}

/** Nav-badge counts: two head-counts riding the partial indexes. */
export async function opsAlertCounts(): Promise<{
  unclaimed: number;
  backlog: number;
}> {
  const admin = createAdminClient();
  const [unclaimed, backlog] = await Promise.all([
    admin
      .from("payments")
      .select("id", { count: "exact", head: true })
      .is("subscription_id", null)
      .is("org_subscription_id", null)
      .in("status", ["captured", "partially_refunded"]),
    admin
      .from("payment_events")
      .select("id", { count: "exact", head: true })
      .is("processed_at", null),
  ]);
  return { unclaimed: unclaimed.count ?? 0, backlog: backlog.count ?? 0 };
}

/**
 * The accounting export: one row per day × breakdown key over the range,
 * refund-only days included (a refund can land on a day with no sales).
 * Exam ids resolve to names; money stays in integer cents.
 */
export async function getRevenueCsvRows(
  range: RangePreset,
  examId: string | null
): Promise<RevenueCsvRow[]> {
  const admin = createAdminClient();
  const today = analyticsDay(new Date());
  const start = rangeStartFor(range, today);
  const { gross, refunds } = await fetchRevenueRows(admin, start, examId);

  const examIds = [
    ...new Set(
      [...gross, ...refunds].map((r) => r.exam_key).filter((k) => k !== NONE_KEY)
    ),
  ];
  const examNames = await examNamesById(admin, examIds);
  const label = (key: string): string =>
    key === NONE_KEY ? NONE_EXAM_LABEL : (examNames.get(key) ?? key);

  const rows = new Map<string, RevenueCsvRow>();
  const keyOf = (r: {
    day: string;
    exam_key: string;
    plan_key: string;
    channel: string;
    source: string;
    currency: string;
  }): string =>
    [r.day, r.exam_key, r.plan_key, r.channel, r.source, r.currency].join(" ");
  const of = (r: AnalyticsDailyRevenue | AnalyticsDailyRefund): RevenueCsvRow => {
    const id = keyOf(r);
    const row =
      rows.get(id) ??
      {
        day: r.day,
        exam: label(r.exam_key),
        plan: r.plan_key,
        channel: r.channel,
        source: r.source,
        currency: r.currency,
        payments: 0,
        grossCents: 0,
        refundCents: 0,
      };
    rows.set(id, row);
    return row;
  };
  for (const g of gross) {
    const row = of(g);
    row.payments += g.payments_count;
    row.grossCents += g.gross_cents;
  }
  for (const r of refunds) of(r).refundCents += r.refund_cents;

  return [...rows.values()].sort(
    (a, b) => a.day.localeCompare(b.day) || a.exam.localeCompare(b.exam)
  );
}

/** Public exams for the dashboard's filter dropdown (org banks excluded —
 * their revenue rows key on the PUBLIC exam that was sold). */
export async function listExamOptions(): Promise<{ id: string; name: string }[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("exams")
    .select("id, name")
    .is("org_id", null)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function examNamesById(
  admin: AdminClient,
  ids: readonly string[]
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await admin
    .from("exams")
    .select("id, name")
    .in("id", [...ids]);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((e) => [e.id, e.name]));
}
