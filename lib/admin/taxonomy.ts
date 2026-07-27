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

/** What a level of the tree holds, counted all the way down. */
export type TaxonomyCounts = {
  subjectCount: number;
  topicCount: number;
  questionCount: number;
};

function rollUp(subjects: readonly SubjectWithTopics[]): TaxonomyCounts {
  const topics = subjects.flatMap((s) => s.topics);
  return {
    subjectCount: subjects.length,
    topicCount: topics.length,
    questionCount: topics.reduce((sum, t) => sum + t.questionCount, 0),
  };
}

export type ExamCard = Exam & TaxonomyCounts & { specialtyCount: number };

/** Exam summaries for the index page's cards. */
export async function listExamCards(): Promise<ExamCard[]> {
  const hierarchy = await listHierarchy();

  return hierarchy.map(({ specialties, ...exam }) => ({
    ...exam,
    specialtyCount: specialties.length,
    ...rollUp(specialties.flatMap((sp) => sp.subjects)),
  }));
}

export type SpecialtyWithMeta = Specialty & TaxonomyCounts;
export type ExamWithSpecialties = Exam & { specialties: SpecialtyWithMeta[] };

/** One exam and its specialties — everything the detail page manages. */
export async function getExam(id: string): Promise<ExamWithSpecialties | null> {
  const hierarchy = await listHierarchy();
  const found = hierarchy.find((e) => e.id === id);
  if (!found) return null;

  const { specialties, ...exam } = found;
  return {
    ...exam,
    specialties: specialties.map(({ subjects, ...sp }) => ({
      ...sp,
      ...rollUp(subjects),
    })),
  };
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

export type TopicOption = {
  id: string;
  name: string;
  subjectName: string;
  specialtyName: string;
  /**
   * A question's exam is only ever implied — questions → topics → subjects →
   * specialties → exams. The editor still has to *show* it, so carry it down
   * with the topic rather than making the picker re-derive it.
   */
  examId: string;
  examName: string;
};

export type SubjectCard = Subject & {
  topicCount: number;
  questionCount: number;
  deletedCount: number;
};

/**
 * Card shape for the subjects index. Pure — the caller already has the tree,
 * and the index has no reason to ship every topic to the client.
 */
export function toSubjectCards(
  subjects: readonly SubjectWithTopics[]
): SubjectCard[] {
  return subjects.map(({ topics, ...subject }) => ({
    ...subject,
    topicCount: topics.length,
  }));
}

export type SubjectDetail = SubjectWithTopics & {
  specialtyName: string;
  examId: string;
  examName: string;
};

/** One subject, its topics, and the trail back up — for the detail page. */
export async function getSubject(id: string): Promise<SubjectDetail | null> {
  const hierarchy = await listHierarchy();

  for (const exam of hierarchy) {
    for (const specialty of exam.specialties) {
      const subject = specialty.subjects.find((s) => s.id === id);
      if (subject) {
        return {
          ...subject,
          specialtyName: specialty.name,
          examId: exam.id,
          examName: exam.name,
        };
      }
    }
  }
  return null;
}

/** Flat topic list for the editor's picker. */
export async function listTopicOptions(): Promise<TopicOption[]> {
  const hierarchy = await listHierarchy();
  return hierarchy.flatMap((exam) =>
    exam.specialties.flatMap((sp) =>
      sp.subjects.flatMap((s) =>
        s.topics.map((t) => ({
          id: t.id,
          name: t.name,
          subjectName: s.name,
          specialtyName: sp.name,
          examId: exam.id,
          examName: exam.name,
        }))
      )
    )
  );
}

/** Next position value for a new row in an ordered list. */
export function nextPosition(rows: readonly { position: number }[]): number {
  return rows.reduce((max, r) => Math.max(max, r.position), -1) + 1;
}
