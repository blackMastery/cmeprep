import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Subject, Topic } from "@/lib/supabase/types";

export type TopicWithCount = Topic & {
  /** Live questions — the number an admin actually cares about. */
  questionCount: number;
  /**
   * Soft-deleted questions. Tracked separately because they still hold their
   * FK to `topics` and so still block a topic delete, even though they should
   * never be counted as content.
   */
  deletedCount: number;
};

export type SubjectWithTopics = Subject & {
  topics: TopicWithCount[];
  questionCount: number;
  deletedCount: number;
};

/**
 * Full taxonomy with per-topic question counts.
 *
 * Live and soft-deleted counts are kept apart on purpose: the live count is
 * what the UI shows, while the deleted count is what explains an otherwise
 * baffling "can't delete this topic" error.
 */
export async function listTaxonomy(): Promise<SubjectWithTopics[]> {
  const admin = createAdminClient();

  const [{ data: subjects }, { data: topics }, { data: questions }] =
    await Promise.all([
      admin.from("subjects").select("*").order("position").order("name"),
      admin.from("topics").select("*").order("position").order("name"),
      admin.from("questions").select("topic_id, deleted_at"),
    ]);

  const liveByTopic = new Map<string, number>();
  const deletedByTopic = new Map<string, number>();
  for (const q of questions ?? []) {
    const bucket = q.deleted_at ? deletedByTopic : liveByTopic;
    bucket.set(q.topic_id, (bucket.get(q.topic_id) ?? 0) + 1);
  }

  return (subjects ?? []).map((subject) => {
    const own = (topics ?? [])
      .filter((t) => t.subject_id === subject.id)
      .map((t) => ({
        ...t,
        questionCount: liveByTopic.get(t.id) ?? 0,
        deletedCount: deletedByTopic.get(t.id) ?? 0,
      }));

    return {
      ...subject,
      topics: own,
      questionCount: own.reduce((sum, t) => sum + t.questionCount, 0),
      deletedCount: own.reduce((sum, t) => sum + t.deletedCount, 0),
    };
  });
}

/** Flat topic list for the editor's picker. */
export async function listTopicOptions(): Promise<
  { id: string; name: string; subjectName: string }[]
> {
  const taxonomy = await listTaxonomy();
  return taxonomy.flatMap((s) =>
    s.topics.map((t) => ({ id: t.id, name: t.name, subjectName: s.name }))
  );
}

/** Next position value for a new row in an ordered list. */
export function nextPosition(rows: readonly { position: number }[]): number {
  return rows.reduce((max, r) => Math.max(max, r.position), -1) + 1;
}
