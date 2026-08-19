import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { osceCapWindowStart } from "@/lib/osce-grading-core";

export const OSCE_EVENTS_PAGE_SIZE = 50;

export type GradingEventRow = {
  id: string;
  createdAt: string;
  userName: string;
  questionStem: string;
  answerText: string;
  /** Null = the call failed; error carries the detail. */
  verdict: "correct" | "incorrect" | null;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  durationMs: number;
  error: string | null;
};

export type GradingEventsPage = {
  rows: GradingEventRow[];
  total: number;
  page: number;
  pageCount: number;
};

type EventJoinRow = {
  id: string;
  created_at: string;
  answer_text: string;
  verdict: "correct" | "incorrect" | null;
  model: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  duration_ms: number;
  error: string | null;
  profiles: { full_name: string | null } | null;
  questions: { stem: string } | null;
};

/** Newest first — this is a forensics/spend log, not a dashboard. */
export async function listGradingEvents(page: number): Promise<GradingEventsPage> {
  const admin = createAdminClient();
  const safePage = Math.max(1, Math.floor(page));
  const from = (safePage - 1) * OSCE_EVENTS_PAGE_SIZE;

  const { data, count } = await admin
    .from("osce_grading_events")
    .select(
      "id, created_at, answer_text, verdict, model, prompt_tokens, completion_tokens, duration_ms, error, profiles(full_name), questions(stem)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    // Unique tiebreak so equal timestamps can't skip/duplicate across pages.
    .order("id", { ascending: false })
    .range(from, from + OSCE_EVENTS_PAGE_SIZE - 1);

  const total = count ?? 0;
  return {
    rows: ((data ?? []) as unknown as EventJoinRow[]).map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      userName: r.profiles?.full_name ?? "Unknown user",
      questionStem: r.questions?.stem ?? "",
      answerText: r.answer_text,
      verdict: r.verdict,
      model: r.model,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      durationMs: r.duration_ms,
      error: r.error,
    })),
    total,
    page: safePage,
    pageCount: Math.max(1, Math.ceil(total / OSCE_EVENTS_PAGE_SIZE)),
  };
}

export type OsceDaySummary = {
  /** Successful grades since Guyana midnight (what burns user caps). */
  gradedToday: number;
  failedToday: number;
  tokensToday: number;
};

export async function osceDaySummary(): Promise<OsceDaySummary> {
  const admin = createAdminClient();
  const since = osceCapWindowStart(new Date());

  const { data } = await admin
    .from("osce_grading_events")
    .select("verdict, prompt_tokens, completion_tokens")
    .gte("created_at", since);

  let gradedToday = 0;
  let failedToday = 0;
  let tokensToday = 0;
  for (const r of data ?? []) {
    if (r.verdict === null) failedToday += 1;
    else gradedToday += 1;
    tokensToday += (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0);
  }
  return { gradedToday, failedToday, tokensToday };
}

export type GradeReportRow = {
  id: string;
  createdAt: string;
  userName: string;
  questionId: string;
  questionStem: string;
  note: string | null;
  /** The reported grade's verdict, when the event survived. */
  verdict: "correct" | "incorrect" | null;
  answerText: string | null;
  handledAt: string | null;
};

type ReportJoinRow = {
  id: string;
  created_at: string;
  question_id: string;
  note: string | null;
  handled_at: string | null;
  profiles: { full_name: string | null } | null;
  questions: { stem: string } | null;
  osce_grading_events: {
    verdict: "correct" | "incorrect" | null;
    answer_text: string;
  } | null;
};

/** Open reports first, then handled — same triage shape as messages. */
export async function listGradeReports(): Promise<GradeReportRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("osce_grade_reports")
    .select(
      // The profiles embed MUST name its foreign key: this table has two
      // (user_id and handled_by), and a bare `profiles(...)` is ambiguous —
      // PostgREST rejects the whole request with PGRST201, which rendered as
      // a permanently empty queue because the error was discarded.
      "id, created_at, question_id, note, handled_at, profiles!osce_grade_reports_user_id_fkey(full_name), questions(stem), osce_grading_events(verdict, answer_text)"
    )
    .order("handled_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(`could not read grade reports: ${error.message}`);

  return ((data ?? []) as unknown as ReportJoinRow[]).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    userName: r.profiles?.full_name ?? "Unknown user",
    questionId: r.question_id,
    questionStem: r.questions?.stem ?? "",
    note: r.note,
    verdict: r.osce_grading_events?.verdict ?? null,
    answerText: r.osce_grading_events?.answer_text ?? null,
    handledAt: r.handled_at,
  }));
}
