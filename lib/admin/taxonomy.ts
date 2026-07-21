import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Exam, Specialty, Subject, Topic } from "@/lib/supabase/types";

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
export async function listTaxonomy(
  specialtyId?: string
): Promise<SubjectWithTopics[]> {
  const admin = createAdminClient();

  let subjectsQuery = admin
    .from("subjects")
    .select("*")
    .order("position")
    .order("name");
  if (specialtyId) subjectsQuery = subjectsQuery.eq("specialty_id", specialtyId);

  const [{ data: subjects }, { data: topics }, { data: questions }] =
    await Promise.all([
      subjectsQuery,
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

export type SpecialtyWithMeta = Specialty & { subjectCount: number };
export type ExamWithSpecialties = Exam & { specialties: SpecialtyWithMeta[] };

/** Exams with their specialties and per-specialty subject counts. */
export async function listExamTree(): Promise<ExamWithSpecialties[]> {
  const admin = createAdminClient();

  const [{ data: exams }, { data: specialties }, { data: subjects }] =
    await Promise.all([
      admin.from("exams").select("*").order("position").order("name"),
      admin.from("specialties").select("*").order("position").order("name"),
      admin.from("subjects").select("id, specialty_id"),
    ]);

  const subjectCount = new Map<string, number>();
  for (const s of subjects ?? []) {
    subjectCount.set(s.specialty_id, (subjectCount.get(s.specialty_id) ?? 0) + 1);
  }

  return (exams ?? []).map((exam) => ({
    ...exam,
    specialties: (specialties ?? [])
      .filter((sp) => sp.exam_id === exam.id)
      .map((sp) => ({ ...sp, subjectCount: subjectCount.get(sp.id) ?? 0 })),
  }));
}

export type ExamHierarchy = Exam & {
  specialties: (Specialty & { subjects: SubjectWithTopics[] })[];
};

/** The full four-level tree — filters, pickers and import all read this. */
export async function listHierarchy(): Promise<ExamHierarchy[]> {
  const admin = createAdminClient();

  const [subjects, { data: exams }, { data: specialties }] = await Promise.all([
    listTaxonomy(),
    admin.from("exams").select("*").order("position").order("name"),
    admin.from("specialties").select("*").order("position").order("name"),
  ]);

  return (exams ?? []).map((exam) => ({
    ...exam,
    specialties: (specialties ?? [])
      .filter((sp) => sp.exam_id === exam.id)
      .map((sp) => ({
        ...sp,
        subjects: subjects.filter((s) => s.specialty_id === sp.id),
      })),
  }));
}

/** Flat topic list for the editor's picker. */
export async function listTopicOptions(): Promise<
  { id: string; name: string; subjectName: string; specialtyName: string }[]
> {
  const hierarchy = await listHierarchy();
  return hierarchy.flatMap((exam) =>
    exam.specialties.flatMap((sp) =>
      sp.subjects.flatMap((s) =>
        s.topics.map((t) => ({
          id: t.id,
          name: t.name,
          subjectName: s.name,
          specialtyName: sp.name,
        }))
      )
    )
  );
}

/** Next position value for a new row in an ordered list. */
export function nextPosition(rows: readonly { position: number }[]): number {
  return rows.reduce((max, r) => Math.max(max, r.position), -1) + 1;
}
