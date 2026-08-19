import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { TutorRating } from "@/lib/supabase/types";

type Admin = ReturnType<typeof createAdminClient>;

export type TutorFeedbackRow = {
  id: string;
  createdAt: string;
  userName: string;
  rating: TutorRating;
  note: string | null;
  handledAt: string | null;
  /** The reported answer. */
  answer: string;
  model: string | null;
  /** Chunks the answer was built from — empty means it was a refusal. */
  chunkIds: string[];
  promptTokens: number | null;
  completionTokens: number | null;
  /** The question that produced it, recovered from the audit trail. */
  question: string | null;
};

type FeedbackJoinRow = {
  id: string;
  created_at: string;
  rating: TutorRating;
  note: string | null;
  handled_at: string | null;
  user_id: string;
  message_id: string;
  profiles: { full_name: string | null } | null;
  chat_messages: {
    content: string;
    model: string | null;
    chunk_ids: string[] | null;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    created_at: string;
  } | null;
};

/**
 * The tutor feedback queue: unhandled first, newest first.
 *
 * The question is not stored on the report — chat_messages is a flat
 * append-only log, so the prompt that produced a reported answer is that
 * student's most recent `user` row before it. Recovered rather than
 * denormalised, in ONE query per reporting user (not one per report): the
 * queue tops out at 200 rows and a handful of students usually account for
 * most of them.
 *
 * The profiles embed must name its foreign key. This table has two FKs to
 * profiles (user_id and handled_by), so a bare `profiles(...)` is ambiguous
 * and PostgREST rejects the whole request with PGRST201 — which, with the
 * error discarded, would render as a permanently empty queue.
 */
export async function listTutorFeedback(): Promise<TutorFeedbackRow[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("tutor_answer_feedback")
    .select(
      "id, created_at, rating, note, handled_at, user_id, message_id, profiles!tutor_answer_feedback_user_id_fkey(full_name), chat_messages(content, model, chunk_ids, prompt_tokens, completion_tokens, created_at)"
    )
    .order("handled_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(200);

  // Surfaced, not swallowed: a malformed embed fails 100% of the time and
  // would otherwise be indistinguishable from "no reports yet".
  if (error) throw new Error(`could not read tutor feedback: ${error.message}`);

  const rows = (data ?? []) as unknown as FeedbackJoinRow[];

  const questions = await questionsFor(admin, rows);

  return rows.map((r, i) => ({
    id: r.id,
    createdAt: r.created_at,
    userName: r.profiles?.full_name ?? "Unknown user",
    rating: r.rating,
    note: r.note,
    handledAt: r.handled_at,
    answer: r.chat_messages?.content ?? "",
    model: r.chat_messages?.model ?? null,
    chunkIds: r.chat_messages?.chunk_ids ?? [],
    promptTokens: r.chat_messages?.prompt_tokens ?? null,
    completionTokens: r.chat_messages?.completion_tokens ?? null,
    question: questions[i],
  }));
}

/**
 * The question behind each rated answer, keyed by position in `rows`.
 *
 * One query per distinct reporting user, then resolved in memory: the answer's
 * question is the latest `user` message strictly before it. Fetching per
 * row instead would be up to 200 round trips for one page render.
 */
async function questionsFor(
  admin: Admin,
  rows: FeedbackJoinRow[]
): Promise<(string | null)[]> {
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  if (userIds.length === 0) return [];

  const asked = new Map<string, { content: string; created_at: string }[]>();
  await Promise.all(
    userIds.map(async (userId) => {
      const { data } = await admin
        .from("chat_messages")
        .select("content, created_at")
        .eq("user_id", userId)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(400);
      asked.set(userId, data ?? []);
    })
  );

  return rows.map((r) => {
    if (!r.chat_messages) return null;
    // Descending order, so the first row older than the answer is the one
    // that produced it.
    const prior = asked
      .get(r.user_id)
      ?.find((m) => m.created_at < r.chat_messages!.created_at);
    return prior?.content ?? null;
  });
}
