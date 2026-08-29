import { addDays, fillDays, type DayPoint } from "@/lib/analytics-core";

/**
 * AI-tutor token usage — pure rules for the admin usage page. The DB side
 * (two GROUP BY RPCs) lives in lib/admin/tutor-usage.ts; every fold, price
 * and threshold is here so vitest can pin it.
 *
 * Null tokens are "not measured", never zero: a refusal never reaches the
 * model, and a partial answer persisted on client disconnect has no usage
 * metadata. The RPCs already count those apart (`answers` vs `measured`).
 */

/** USD per 1M tokens, keyed exactly as chat_messages.model stores it
 * ("provider/model"). Source: cmeprep-ai-tutor/cost-estimate.md, which
 * assumes gpt-5.6 at the mid ("terra") tier. Re-check when CHAT_MODEL or the
 * tier changes — a stale rate silently misprices every tile on the page. */
export const MODEL_RATES: Readonly<
  Record<string, { inputPerM: number; outputPerM: number }>
> = {
  "openai/gpt-5.6": { inputPerM: 2.0, outputPerM: 12.0 },
  // The translation model (translation_events.model stores the bare id).
  // ASSUMED the same tier as gpt-5.6 above — confirm against OpenAI's
  // pricing page; a wrong rate misprices only /admin/translations' strip.
  "gpt-5.6-sol": { inputPerM: 2.0, outputPerM: 12.0 },
};
export const RATES_AS_OF = "4 Aug 2026";

/** How many top students the page lists. */
export const TUTOR_USAGE_TOP_USERS = 50;

export type UsageBucket = {
  model: string | null;
  questions: number;
  answers: number;
  measured: number;
  promptTokens: number;
  completionTokens: number;
};
export type UsageDayBucket = UsageBucket & { day: string };
export type UsageUserBucket = UsageBucket & { userId: string; lastAt: string };

/** Null when the model is unpriced (unknown, or null = refusal/user rows). */
export function estimateCostUsd(
  model: string | null,
  promptTokens: number,
  completionTokens: number
): number | null {
  if (model === null) return null;
  const rate = MODEL_RATES[model];
  if (!rate) return null;
  return (
    (promptTokens * rate.inputPerM + completionTokens * rate.outputPerM) /
    1_000_000
  );
}

export function costLabel(usd: number | null): string {
  if (usd === null) return "—";
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

/** 1234 → "1.2k", 1234567 → "1.2M"; small numbers unchanged. Axis labels
 * and tile values, where a six-digit figure would not fit. */
export function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

export type UsageTotals = {
  questions: number;
  answers: number;
  /** Questions that never produced an answer row — the tutor stream failed. */
  failed: number;
  measured: number;
  /** Answers with no usage metadata: refusals and disconnect-persisted partials. */
  unmeasured: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Over MEASURED answers only; null when there are none. */
  avgTokensPerAnswer: number | null;
  /** Null only when nothing in the set could be priced. */
  estCostUsd: number | null;
  /** Tokens on models with no rate — shown so the estimate is never read as complete. */
  unpricedTokens: number;
};

/** A priced cost fold across buckets, per model on the AGGREGATED tokens
 * (pricing per row and summing would be the same arithmetic, but rounding
 * happens once, at display). */
function priceBuckets(rows: readonly UsageBucket[]): {
  estCostUsd: number | null;
  unpricedTokens: number;
} {
  const byModel = new Map<string, { prompt: number; completion: number }>();
  let unpricedTokens = 0;
  for (const r of rows) {
    const tokens = r.promptTokens + r.completionTokens;
    if (tokens === 0) continue;
    if (r.model === null || !MODEL_RATES[r.model]) {
      unpricedTokens += tokens;
      continue;
    }
    const acc = byModel.get(r.model) ?? { prompt: 0, completion: 0 };
    acc.prompt += r.promptTokens;
    acc.completion += r.completionTokens;
    byModel.set(r.model, acc);
  }
  let estCostUsd: number | null = null;
  for (const [model, t] of byModel) {
    const usd = estimateCostUsd(model, t.prompt, t.completion);
    if (usd !== null) estCostUsd = (estCostUsd ?? 0) + usd;
  }
  return { estCostUsd, unpricedTokens };
}

export function summariseUsage(rows: readonly UsageBucket[]): UsageTotals {
  let questions = 0;
  let answers = 0;
  let measured = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  for (const r of rows) {
    questions += r.questions;
    answers += r.answers;
    measured += r.measured;
    promptTokens += r.promptTokens;
    completionTokens += r.completionTokens;
  }
  const totalTokens = promptTokens + completionTokens;
  return {
    questions,
    answers,
    failed: Math.max(0, questions - answers),
    measured,
    unmeasured: answers - measured,
    promptTokens,
    completionTokens,
    totalTokens,
    avgTokensPerAnswer: measured === 0 ? null : Math.round(totalTokens / measured),
    ...priceBuckets(rows),
  };
}

/** Dense per-day series for the chart. Additive, so an empty day IS zero
 * (unlike ratio series, where null breaks the line). */
export function usageDayPoints(
  rows: readonly UsageDayBucket[],
  from: string,
  to: string
): { prompt: DayPoint[]; completion: DayPoint[] } {
  return {
    prompt: fillDays(from, to, rows, (r) => r.promptTokens, 0),
    completion: fillDays(from, to, rows, (r) => r.completionTokens, 0),
  };
}

/** Where the chart's x-axis starts: the preset's first day, or for "all
 * time" the earliest day with data (today when there is none) — an axis
 * from 1970 would flatten every real point into the right edge. */
export function chartStartFor(
  rangeStart: string | null,
  rows: readonly UsageDayBucket[],
  today: string
): string {
  if (rangeStart !== null) return rangeStart;
  let earliest: string | null = null;
  for (const r of rows) if (earliest === null || r.day < earliest) earliest = r.day;
  // Never after today: a clock-skewed future row would invert the axis.
  return earliest === null || earliest > today ? today : earliest;
}

export type ModelRow = {
  model: string | null;
  answers: number;
  measured: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estCostUsd: number | null;
};

/** Per-model totals, heaviest first; the null model (refusals) last. */
export function usageByModel(rows: readonly UsageBucket[]): ModelRow[] {
  const byModel = new Map<string | null, ModelRow>();
  for (const r of rows) {
    // User rows live in the null bucket too; they carry no answers or tokens,
    // so they fold to nothing — but a null row with zero answers is noise.
    const row =
      byModel.get(r.model) ??
      {
        model: r.model,
        answers: 0,
        measured: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estCostUsd: null,
      };
    row.answers += r.answers;
    row.measured += r.measured;
    row.promptTokens += r.promptTokens;
    row.completionTokens += r.completionTokens;
    byModel.set(r.model, row);
  }
  const out: ModelRow[] = [];
  for (const row of byModel.values()) {
    if (row.answers === 0) continue;
    row.totalTokens = row.promptTokens + row.completionTokens;
    row.estCostUsd = estimateCostUsd(row.model, row.promptTokens, row.completionTokens);
    out.push(row);
  }
  return out.sort((a, b) => {
    if (a.model === null) return 1;
    if (b.model === null) return -1;
    return b.totalTokens - a.totalTokens || a.model.localeCompare(b.model);
  });
}

export type UserIdentity = { name: string; email: string | null };

export type UserRow = UserIdentity & {
  userId: string;
  questions: number;
  answers: number;
  measured: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Of the whole range's tokens (from the by-day fold), not of the top-N. */
  sharePct: number;
  estCostUsd: number | null;
  lastAt: string;
};

/**
 * One row per student from (user, model) buckets, heaviest first. Share is
 * against the RANGE total so the column reads "this student is 40% of spend"
 * even when the list is capped.
 */
export function usageByUser(
  rows: readonly UsageUserBucket[],
  rangeTotalTokens: number,
  identity: (userId: string) => UserIdentity
): UserRow[] {
  const byUser = new Map<string, { buckets: UsageUserBucket[]; lastAt: string }>();
  for (const r of rows) {
    const acc = byUser.get(r.userId) ?? { buckets: [], lastAt: r.lastAt };
    acc.buckets.push(r);
    if (r.lastAt > acc.lastAt) acc.lastAt = r.lastAt;
    byUser.set(r.userId, acc);
  }
  const out: UserRow[] = [];
  for (const [userId, acc] of byUser) {
    const t = summariseUsage(acc.buckets);
    out.push({
      userId,
      ...identity(userId),
      questions: t.questions,
      answers: t.answers,
      measured: t.measured,
      promptTokens: t.promptTokens,
      completionTokens: t.completionTokens,
      totalTokens: t.totalTokens,
      sharePct:
        rangeTotalTokens === 0
          ? 0
          : Math.round((t.totalTokens / rangeTotalTokens) * 100),
      estCostUsd: t.estCostUsd,
      lastAt: acc.lastAt,
    });
  }
  return out.sort(
    (a, b) => b.totalTokens - a.totalTokens || b.lastAt.localeCompare(a.lastAt)
  );
}

/** Inclusive day span length, for the "N days" caption. */
export function daySpan(from: string, to: string): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) n += 1;
  return n;
}
