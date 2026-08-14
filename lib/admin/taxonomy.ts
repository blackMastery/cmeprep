import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Exam, Specialty, Subject } from "@/lib/supabase/types";

export type SubjectWithCount = Subject & {
  /** Live questions — the number an admin actually cares about. */
  questionCount: number;
  /**
   * Soft-deleted questions. Tracked separately because they still hold their
   * FK to `subjects` and so still block a subject delete, even though they
   * should never be counted as content.
   */
  deletedCount: number;
};

/**
 * PostgREST caps a single response at 1000 rows by default. A bank with
 * more questions than that (PLAB alone is already near the limit) would
 * under-count every exam whose rows fell past the cut-off. Page through
 * until a short page proves we've seen them all.
 */
const QUESTION_PAGE = 1000;

async function questionCountsBySubject(): Promise<{
  liveBySubject: Map<string, number>;
  deletedBySubject: Map<string, number>;
}> {
  const admin = createAdminClient();
  const liveBySubject = new Map<string, number>();
  const deletedBySubject = new Map<string, number>();

  for (let from = 0; ; from += QUESTION_PAGE) {
    const { data } = await admin
      .from("questions")
      .select("subject_id, deleted_at")
      .range(from, from + QUESTION_PAGE - 1);

    for (const q of data ?? []) {
      const bucket = q.deleted_at ? deletedBySubject : liveBySubject;
      bucket.set(q.subject_id, (bucket.get(q.subject_id) ?? 0) + 1);
    }

    if ((data?.length ?? 0) < QUESTION_PAGE) break;
  }

  return { liveBySubject, deletedBySubject };
}

/**
 * Subjects with their question counts.
 *
 * Live and soft-deleted counts are kept apart on purpose: the live count is
 * what the UI shows, while the deleted count is what explains an otherwise
 * baffling "can't delete this subject" error.
 */
export async function listTaxonomy(
  specialtyId?: string
): Promise<SubjectWithCount[]> {
  const admin = createAdminClient();

  let subjectsQuery = admin
    .from("subjects")
    .select("*")
    .order("position")
    .order("name");
  if (specialtyId) subjectsQuery = subjectsQuery.eq("specialty_id", specialtyId);

  const [{ data: subjects }, { liveBySubject, deletedBySubject }] =
    await Promise.all([subjectsQuery, questionCountsBySubject()]);

  return (subjects ?? []).map((subject) => ({
    ...subject,
    questionCount: liveBySubject.get(subject.id) ?? 0,
    deletedCount: deletedBySubject.get(subject.id) ?? 0,
  }));
}

/** What a level of the tree holds, counted all the way down. */
export type TaxonomyCounts = {
  subjectCount: number;
  questionCount: number;
};

function rollUp(subjects: readonly SubjectWithCount[]): TaxonomyCounts {
  return {
    subjectCount: subjects.length,
    questionCount: subjects.reduce((sum, s) => sum + s.questionCount, 0),
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
export type ExamWithSpecialties = Exam & {
  specialties: SpecialtyWithMeta[];
  /** Rows in `subscriptions` scoped to this exam — blocks hard delete. */
  subscriptionCount: number;
};

/** One exam and its specialties — everything the detail page manages. */
export async function getExam(id: string): Promise<ExamWithSpecialties | null> {
  const hierarchy = await listHierarchy();
  const found = hierarchy.find((e) => e.id === id);
  if (!found) return null;

  const admin = createAdminClient();
  const { count: subscriptionCount } = await admin
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("exam_id", id);

  const { specialties, ...exam } = found;
  return {
    ...exam,
    subscriptionCount: subscriptionCount ?? 0,
    specialties: specialties.map(({ subjects, ...sp }) => ({
      ...sp,
      ...rollUp(subjects),
    })),
  };
}

export type ExamHierarchy = Exam & {
  specialties: (Specialty & { subjects: SubjectWithCount[] })[];
};

/**
 * The full three-level tree — filters, pickers and import all read this.
 *
 * `orgId` narrows to one org's private bank (the /org/content surfaces);
 * omitted = every exam, org banks included, for platform admins.
 */
export async function listHierarchy(orgId?: string): Promise<ExamHierarchy[]> {
  const admin = createAdminClient();

  let examsQuery = admin.from("exams").select("*").order("position").order("name");
  if (orgId) examsQuery = examsQuery.eq("org_id", orgId);

  const [subjects, { data: exams }, { data: specialties }] = await Promise.all([
    listTaxonomy(),
    examsQuery,
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

export type SubjectOption = {
  id: string;
  name: string;
  specialtyName: string;
  /**
   * A question's exam is only ever implied — questions → subjects →
   * specialties → exams. The editor still has to *show* it, so carry it down
   * with the subject rather than making the picker re-derive it.
   */
  examId: string;
  examName: string;
};

/** Flat subject list for the question editor's picker. */
export async function listSubjectOptions(
  orgId?: string
): Promise<SubjectOption[]> {
  const hierarchy = await listHierarchy(orgId);
  return hierarchy.flatMap((exam) =>
    exam.specialties.flatMap((sp) =>
      sp.subjects.map((s) => ({
        id: s.id,
        name: s.name,
        specialtyName: sp.name,
        examId: exam.id,
        examName: exam.name,
      }))
    )
  );
}

export type SubjectDetail = SubjectWithCount & {
  specialtyName: string;
  examId: string;
  examName: string;
};

/** One subject and the trail back up — for the detail page. */
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

/** Next position value for a new row in an ordered list. */
export function nextPosition(rows: readonly { position: number }[]): number {
  return rows.reduce((max, r) => Math.max(max, r.position), -1) + 1;
}
