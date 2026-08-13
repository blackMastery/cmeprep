/**
 * The student-facing taxonomy, assembled and counted.
 *
 * Pure so vitest can cover the roll-ups — the reading half is lib/catalog.ts.
 * This is deliberately NOT lib/admin/taxonomy.ts: that module is server-only
 * and uses the service-role client, and its counts include unpublished
 * questions. Buyers and students must see published counts only.
 */

export type CatalogSubject = {
  id: string;
  name: string;
  questionCount: number;
};

export type CatalogSpecialty = {
  id: string;
  name: string;
  subjects: CatalogSubject[];
  subjectCount: number;
  questionCount: number;
};

/** Counts only — what cards and pickers render before you expand anything. */
export type CatalogExam = {
  id: string;
  name: string;
  code: string | null;
  /**
   * Offered for sale. The catalogue keeps returning inactive exams so name
   * lookups (receipts, expiry banners, the profile) still resolve for people
   * who bought one before it was retired — callers that SELL filter on this.
   */
  isActive: boolean;
  /** Private-bank owner; null = public catalog. Org exams are never sold. */
  orgId: string | null;
  specialtyCount: number;
  subjectCount: number;
  questionCount: number;
};

export type CatalogExamDetail = CatalogExam & {
  specialties: CatalogSpecialty[];
};

export type CatalogRows = {
  exams: {
    id: string;
    name: string;
    code: string | null;
    is_active: boolean;
    org_id: string | null;
  }[];
  specialties: { id: string; name: string; exam_id: string }[];
  subjects: { id: string; name: string; specialty_id: string }[];
  /** Only subjects with at least one published question appear here. */
  counts: { subject_id: string; question_count: number }[];
};

function sum<T>(rows: readonly T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

/**
 * Nest the three flat selects into a tree, rolling published-question counts
 * up from subjects. Input order is preserved, so the caller's `position` sort
 * carries through to the UI.
 */
export function assembleCatalog(rows: CatalogRows): CatalogExamDetail[] {
  const questionsBySubject = new Map(
    rows.counts.map((c) => [c.subject_id, c.question_count])
  );

  const subjectsBySpecialty = new Map<string, CatalogSubject[]>();
  for (const subject of rows.subjects) {
    const list = subjectsBySpecialty.get(subject.specialty_id) ?? [];
    list.push({
      id: subject.id,
      name: subject.name,
      questionCount: questionsBySubject.get(subject.id) ?? 0,
    });
    subjectsBySpecialty.set(subject.specialty_id, list);
  }

  const specialtiesByExam = new Map<string, CatalogSpecialty[]>();
  for (const specialty of rows.specialties) {
    const subjects = subjectsBySpecialty.get(specialty.id) ?? [];
    const list = specialtiesByExam.get(specialty.exam_id) ?? [];
    list.push({
      id: specialty.id,
      name: specialty.name,
      subjects,
      subjectCount: subjects.length,
      questionCount: sum(subjects, (s) => s.questionCount),
    });
    specialtiesByExam.set(specialty.exam_id, list);
  }

  return rows.exams.map((exam) => {
    const specialties = specialtiesByExam.get(exam.id) ?? [];
    return {
      id: exam.id,
      name: exam.name,
      code: exam.code,
      isActive: exam.is_active,
      orgId: exam.org_id,
      specialties,
      specialtyCount: specialties.length,
      subjectCount: sum(specialties, (sp) => sp.subjectCount),
      questionCount: sum(specialties, (sp) => sp.questionCount),
    };
  });
}

/** Drop the tree — pickers listing every exam should not ship every subject. */
export function toExamSummary(exam: CatalogExamDetail): CatalogExam {
  return {
    id: exam.id,
    name: exam.name,
    code: exam.code,
    isActive: exam.isActive,
    orgId: exam.orgId,
    specialtyCount: exam.specialtyCount,
    subjectCount: exam.subjectCount,
    questionCount: exam.questionCount,
  };
}

/**
 * The exams a buyer may put money on.
 *
 * Deliberately not applied inside assembleCatalog: retiring an exam must not
 * blank its name on a receipt or an expiry banner, so the catalogue stays
 * complete and only the selling surfaces narrow. Org exams are excluded even
 * when is_active — a member browsing checkout must never be offered their
 * own org's private bank as a product.
 */
export function sellableExams<
  T extends { isActive: boolean; orgId: string | null },
>(exams: readonly T[]): T[] {
  return exams.filter((exam) => exam.isActive && exam.orgId === null);
}
