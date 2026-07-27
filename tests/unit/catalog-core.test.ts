import { describe, expect, it } from "vitest";
import {
  assembleCatalog,
  toExamSummary,
  type CatalogRows,
} from "@/lib/catalog-core";

const EXAM = "e0000000-0000-0000-0000-000000000001";
const SPEC = "5c000000-0000-0000-0000-000000000001";
const SUBJ = "11111111-1111-1111-1111-111111111111";
const SUBJ_2 = "22222222-2222-2222-2222-222222222222";
const TOPIC = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const TOPIC_2 = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const TOPIC_3 = "cccccccc-3333-4333-8333-cccccccccccc";

function rows(overrides: Partial<CatalogRows> = {}): CatalogRows {
  return {
    exams: [{ id: EXAM, name: "Medical Board Exam", code: "CAMC" }],
    specialties: [{ id: SPEC, name: "General", exam_id: EXAM }],
    subjects: [
      { id: SUBJ, name: "Cardiology", specialty_id: SPEC },
      { id: SUBJ_2, name: "Neurology", specialty_id: SPEC },
    ],
    topics: [
      { id: TOPIC, name: "Arrhythmias", subject_id: SUBJ },
      { id: TOPIC_2, name: "Heart failure", subject_id: SUBJ },
      { id: TOPIC_3, name: "Stroke", subject_id: SUBJ_2 },
    ],
    counts: [
      { topic_id: TOPIC, question_count: 12 },
      { topic_id: TOPIC_2, question_count: 8 },
      { topic_id: TOPIC_3, question_count: 5 },
    ],
    ...overrides,
  };
}

describe("assembleCatalog", () => {
  it("nests exam → specialty → subject → topic", () => {
    const [exam] = assembleCatalog(rows());
    expect(exam.name).toBe("Medical Board Exam");
    expect(exam.code).toBe("CAMC");
    expect(exam.specialties[0].subjects[0].topics.map((t) => t.name)).toEqual([
      "Arrhythmias",
      "Heart failure",
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

  it("counts subjects and topics at every level", () => {
    const [exam] = assembleCatalog(rows());
    expect(exam.specialtyCount).toBe(1);
    expect(exam.subjectCount).toBe(2);
    expect(exam.topicCount).toBe(3);
    expect(exam.specialties[0].subjectCount).toBe(2);
    expect(exam.specialties[0].topicCount).toBe(3);
    expect(exam.specialties[0].subjects[0].topicCount).toBe(2);
  });

  it("treats a topic with no counts row as zero, not missing", () => {
    // topic_question_counts only lists topics that HAVE published questions.
    const [exam] = assembleCatalog(rows({ counts: [] }));
    expect(exam.questionCount).toBe(0);
    expect(exam.topicCount).toBe(3);
    expect(exam.specialties[0].subjects[0].topics[0].questionCount).toBe(0);
  });

  it("keeps empty branches rather than dropping them", () => {
    const [exam] = assembleCatalog(rows({ topics: [], counts: [] }));
    expect(exam.subjectCount).toBe(2);
    expect(exam.topicCount).toBe(0);
    expect(exam.specialties[0].subjects[0].topics).toEqual([]);
  });

  it("returns an exam with no specialties as a zeroed shell", () => {
    const [exam] = assembleCatalog(
      rows({ specialties: [], subjects: [], topics: [], counts: [] })
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
        topics: [],
        counts: [],
      })
    ).toEqual([]);
  });

  it("preserves input order so the caller's position sort carries through", () => {
    const second = "e0000000-0000-0000-0000-000000000002";
    const result = assembleCatalog(
      rows({
        exams: [
          { id: second, name: "PLAB", code: null },
          { id: EXAM, name: "Medical Board Exam", code: "CAMC" },
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
          { id: EXAM, name: "Medical Board Exam", code: "CAMC" },
          { id: other, name: "PLAB", code: null },
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
});
