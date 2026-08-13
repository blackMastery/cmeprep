import { describe, expect, it } from "vitest";
import {
  assembleCatalog,
  sellableExams,
  toExamSummary,
  type CatalogRows,
} from "@/lib/catalog-core";

const EXAM = "e0000000-0000-0000-0000-000000000001";
const SPEC = "5c000000-0000-0000-0000-000000000001";
const SUBJ = "11111111-1111-1111-1111-111111111111";
const SUBJ_2 = "22222222-2222-2222-2222-222222222222";

function rows(overrides: Partial<CatalogRows> = {}): CatalogRows {
  return {
    exams: [
      { id: EXAM, name: "Medical Board Exam", code: "CAMC", is_active: true, org_id: null },
    ],
    specialties: [{ id: SPEC, name: "General", exam_id: EXAM }],
    subjects: [
      { id: SUBJ, name: "Cardiology", specialty_id: SPEC },
      { id: SUBJ_2, name: "Neurology", specialty_id: SPEC },
    ],
    counts: [
      { subject_id: SUBJ, question_count: 20 },
      { subject_id: SUBJ_2, question_count: 5 },
    ],
    ...overrides,
  };
}

describe("assembleCatalog", () => {
  it("nests exam → specialty → subject", () => {
    const [exam] = assembleCatalog(rows());
    expect(exam.name).toBe("Medical Board Exam");
    expect(exam.code).toBe("CAMC");
    expect(exam.specialties[0].subjects.map((s) => s.name)).toEqual([
      "Cardiology",
      "Neurology",
    ]);
  });

  it("rolls question counts up every level", () => {
    const [exam] = assembleCatalog(rows());
    const specialty = exam.specialties[0];
    const [cardiology, neurology] = specialty.subjects;

    expect(cardiology.questionCount).toBe(20);
    expect(neurology.questionCount).toBe(5);
    expect(specialty.questionCount).toBe(25);
    expect(exam.questionCount).toBe(25);
  });

  it("counts subjects at every level", () => {
    const [exam] = assembleCatalog(rows());
    expect(exam.specialtyCount).toBe(1);
    expect(exam.subjectCount).toBe(2);
    expect(exam.specialties[0].subjectCount).toBe(2);
  });

  it("treats a subject with no counts row as zero, not missing", () => {
    // subject_question_counts only lists subjects that HAVE published questions.
    const [exam] = assembleCatalog(rows({ counts: [] }));
    expect(exam.questionCount).toBe(0);
    expect(exam.specialties[0].subjects[0].questionCount).toBe(0);
  });

  it("keeps empty branches rather than dropping them", () => {
    const [exam] = assembleCatalog(rows({ counts: [] }));
    expect(exam.subjectCount).toBe(2);
    expect(exam.specialties[0].subjects).toHaveLength(2);
  });

  it("returns an exam with no specialties as a zeroed shell", () => {
    const [exam] = assembleCatalog(
      rows({ specialties: [], subjects: [], counts: [] })
    );
    expect(exam.specialties).toEqual([]);
    expect(exam.specialtyCount).toBe(0);
    expect(exam.questionCount).toBe(0);
  });

  it("returns nothing for an empty catalogue", () => {
    expect(
      assembleCatalog({
        exams: [],
        specialties: [],
        subjects: [],
        counts: [],
      })
    ).toEqual([]);
  });

  it("preserves input order so the caller's position sort carries through", () => {
    const second = "e0000000-0000-0000-0000-000000000002";
    const result = assembleCatalog(
      rows({
        exams: [
          { id: second, name: "PLAB", code: null, is_active: true, org_id: null },
          { id: EXAM, name: "Medical Board Exam", code: "CAMC", is_active: true, org_id: null },
        ],
      })
    );
    expect(result.map((e) => e.name)).toEqual(["PLAB", "Medical Board Exam"]);
  });

  it("does not attach another exam's specialties", () => {
    const other = "e0000000-0000-0000-0000-000000000002";
    const result = assembleCatalog(
      rows({
        exams: [
          { id: EXAM, name: "Medical Board Exam", code: "CAMC", is_active: true, org_id: null },
          { id: other, name: "PLAB", code: null, is_active: true, org_id: null },
        ],
      })
    );
    expect(result[1].specialties).toEqual([]);
    expect(result[1].questionCount).toBe(0);
  });
});

describe("toExamSummary", () => {
  it("drops the tree but keeps every count", () => {
    const [exam] = assembleCatalog(rows());
    const summary = toExamSummary(exam);
    expect(summary).not.toHaveProperty("specialties");
    expect(summary.questionCount).toBe(25);
    expect(summary.subjectCount).toBe(2);
  });

  it("carries availability through to the summary", () => {
    const [exam] = assembleCatalog(
      rows({
        exams: [{ id: EXAM, name: "Retired", code: null, is_active: false, org_id: null }],
      })
    );
    expect(exam.isActive).toBe(false);
    expect(toExamSummary(exam).isActive).toBe(false);
  });
});

describe("sellableExams", () => {
  const retired = "e0000000-0000-0000-0000-000000000002";

  it("keeps only the exams still offered", () => {
    const catalog = assembleCatalog(
      rows({
        exams: [
          { id: EXAM, name: "Medical Board Exam", code: "CAMC", is_active: true, org_id: null },
          { id: retired, name: "PLAB", code: null, is_active: false, org_id: null },
        ],
      })
    );
    expect(sellableExams(catalog).map((e) => e.name)).toEqual([
      "Medical Board Exam",
    ]);
  });

  it("never offers an org's private bank for sale, even when active", () => {
    // A member browsing checkout must not see their org's bank as a product.
    const catalog = assembleCatalog(
      rows({
        exams: [
          {
            id: retired,
            name: "St. Mary's Internal Bank",
            code: null,
            is_active: true,
            org_id: "a0000000-0000-0000-0000-000000000001",
          },
        ],
      })
    );
    expect(sellableExams(catalog)).toEqual([]);
  });

  it("leaves the catalogue itself complete so names still resolve", () => {
    // A receipt or expiry banner has to name a retired exam the buyer owns.
    const catalog = assembleCatalog(
      rows({
        exams: [{ id: retired, name: "PLAB", code: null, is_active: false, org_id: null }],
      })
    );
    expect(catalog).toHaveLength(1);
    expect(sellableExams(catalog)).toEqual([]);
  });
});
