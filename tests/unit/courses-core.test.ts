import { describe, expect, it } from "vitest";
import {
  byPosition,
  courseCompletion,
  coursePublishProblems,
  courseUploadProblem,
  DEFAULT_PASS_PCT,
  fileKindOf,
  firstIncompleteLessonId,
  gradeCourseQuiz,
  reorderSiblings,
  unlockedModuleIds,
  type CoreModule,
  type PublishLesson,
} from "@/lib/courses-core";

const lesson = (id: string, kind: "video" | "text" | "quiz" = "text") => ({
  id,
  kind,
});

const done = (...ids: string[]) => new Set(ids);

describe("unlockedModuleIds", () => {
  const modules: CoreModule[] = [
    { id: "m1", lessons: [lesson("a"), lesson("q1", "quiz")] },
    { id: "m2", lessons: [lesson("b"), lesson("q2", "quiz")] },
    { id: "m3", lessons: [lesson("c")] },
  ];

  it("unlocks only module 1 when nothing is complete", () => {
    expect(unlockedModuleIds(modules, done())).toEqual(new Set(["m1"]));
  });

  it("content completion never unlocks — only quiz passes do", () => {
    expect(unlockedModuleIds(modules, done("a", "b", "c"))).toEqual(
      new Set(["m1"])
    );
  });

  it("passing module 1's quiz unlocks module 2 but not 3", () => {
    expect(unlockedModuleIds(modules, done("q1"))).toEqual(
      new Set(["m1", "m2"])
    );
  });

  it("passing every quiz unlocks everything", () => {
    expect(unlockedModuleIds(modules, done("q1", "q2"))).toEqual(
      new Set(["m1", "m2", "m3"])
    );
  });

  it("a quiz-free course is fully unlocked", () => {
    const free: CoreModule[] = [
      { id: "m1", lessons: [lesson("a")] },
      { id: "m2", lessons: [] },
    ];
    expect(unlockedModuleIds(free, done())).toEqual(new Set(["m1", "m2"]));
  });

  it("two quizzes in one module must BOTH pass to unlock the next", () => {
    const twin: CoreModule[] = [
      { id: "m1", lessons: [lesson("q1", "quiz"), lesson("q2", "quiz")] },
      { id: "m2", lessons: [lesson("b")] },
    ];
    expect(unlockedModuleIds(twin, done("q1"))).toEqual(new Set(["m1"]));
    expect(unlockedModuleIds(twin, done("q1", "q2"))).toEqual(
      new Set(["m1", "m2"])
    );
  });

  it("module 1 is unlocked even for an empty course", () => {
    expect(unlockedModuleIds([], done())).toEqual(new Set());
    expect(unlockedModuleIds([{ id: "m1", lessons: [] }], done())).toEqual(
      new Set(["m1"])
    );
  });
});

describe("courseCompletion", () => {
  const modules: CoreModule[] = [
    { id: "m1", lessons: [lesson("a"), lesson("b")] },
    { id: "m2", lessons: [lesson("c")] },
  ];

  it("counts across modules and rounds the percentage", () => {
    expect(courseCompletion(modules, done("a"))).toEqual({
      completedLessons: 1,
      totalLessons: 3,
      pct: 33,
      done: false,
    });
  });

  it("is done only when every lesson is complete", () => {
    expect(courseCompletion(modules, done("a", "b", "c")).done).toBe(true);
    expect(courseCompletion(modules, done("a", "b")).done).toBe(false);
  });

  it("a lesson-less course is 0% and never done", () => {
    expect(courseCompletion([], done())).toEqual({
      completedLessons: 0,
      totalLessons: 0,
      pct: 0,
      done: false,
    });
  });

  it("ignores progress rows for lessons no longer in the course", () => {
    // Edit-in-place: a deleted lesson's progress row must not inflate %.
    expect(courseCompletion(modules, done("a", "ghost")).completedLessons).toBe(
      1
    );
  });
});

describe("firstIncompleteLessonId", () => {
  const modules: CoreModule[] = [
    { id: "m1", lessons: [lesson("a"), lesson("q1", "quiz")] },
    { id: "m2", lessons: [lesson("b")] },
  ];

  it("starts at the first lesson", () => {
    expect(firstIncompleteLessonId(modules, done())).toBe("a");
  });

  it("skips completed lessons and continues within unlocked modules", () => {
    expect(firstIncompleteLessonId(modules, done("a"))).toBe("q1");
    expect(firstIncompleteLessonId(modules, done("a", "q1"))).toBe("b");
  });

  it("never points into a locked module", () => {
    // "a" done, quiz not passed — m2 is locked, so nothing else to offer
    // beyond the quiz itself.
    expect(firstIncompleteLessonId(modules, done("a"))).toBe("q1");
  });

  it("returns null when the course is finished", () => {
    expect(firstIncompleteLessonId(modules, done("a", "q1", "b"))).toBeNull();
  });
});

describe("gradeCourseQuiz", () => {
  const questions = [
    { id: "q1", correctOptionId: "o1" },
    { id: "q2", correctOptionId: "o2" },
    { id: "q3", correctOptionId: "o3" },
  ];

  it("scores, rounds and passes at the threshold", () => {
    const graded = gradeCourseQuiz(
      questions,
      [
        { questionId: "q1", optionId: "o1" },
        { questionId: "q2", optionId: "o2" },
        { questionId: "q3", optionId: "wrong" },
      ],
      60
    );
    expect(graded.scorePct).toBe(67);
    expect(graded.passed).toBe(true);
    expect(graded.answers).toEqual([
      { question_id: "q1", option_id: "o1", correct: true },
      { question_id: "q2", option_id: "o2", correct: true },
      { question_id: "q3", option_id: "wrong", correct: false },
    ]);
  });

  it("fails below the threshold", () => {
    const graded = gradeCourseQuiz(
      questions,
      [{ questionId: "q1", optionId: "o1" }],
      70
    );
    expect(graded.scorePct).toBe(33);
    expect(graded.passed).toBe(false);
  });

  it("treats unanswered questions as wrong, not as errors", () => {
    const graded = gradeCourseQuiz(questions, [], 70);
    expect(graded.scorePct).toBe(0);
    expect(graded.answers).toHaveLength(3);
    expect(graded.answers.every((a) => !a.correct)).toBe(true);
  });

  it("ignores submissions for unknown questions", () => {
    const graded = gradeCourseQuiz(
      questions,
      [
        { questionId: "nope", optionId: "o1" },
        { questionId: "q1", optionId: "o1" },
      ],
      70
    );
    expect(graded.answers).toHaveLength(3);
    expect(graded.scorePct).toBe(33);
  });

  it("null threshold falls back to the default", () => {
    const all = questions.map((q) => ({
      questionId: q.id,
      optionId: q.correctOptionId,
    }));
    expect(gradeCourseQuiz(questions, all, null).passed).toBe(true);
    expect(DEFAULT_PASS_PCT).toBe(70);
  });

  it("a zero-question quiz is un-passable even at 100%", () => {
    const graded = gradeCourseQuiz([], [], 1);
    expect(graded.scorePct).toBe(0);
    expect(graded.passed).toBe(false);
  });

  it("a question with no correct option can never be scored right", () => {
    const graded = gradeCourseQuiz(
      [{ id: "q1", correctOptionId: null }],
      [{ questionId: "q1", optionId: "o1" }],
      50
    );
    expect(graded.answers[0].correct).toBe(false);
  });
});

describe("byPosition", () => {
  it("orders by position with id as the deterministic tiebreak", () => {
    const rows = [
      { id: "b", position: 1 },
      { id: "a", position: 1 },
      { id: "c", position: 0 },
    ];
    expect(byPosition(rows).map((r) => r.id)).toEqual(["c", "a", "b"]);
    // Input untouched.
    expect(rows[0].id).toBe("b");
  });
});

describe("reorderSiblings", () => {
  const rows = [
    { id: "a", position: 0 },
    { id: "b", position: 1 },
    { id: "c", position: 2 },
  ];

  it("swaps with the neighbour and renumbers the whole list", () => {
    expect(reorderSiblings(rows, "c", "up")).toEqual([
      { id: "a", position: 0 },
      { id: "c", position: 1 },
      { id: "b", position: 2 },
    ]);
  });

  it("renumbers gapped positions instead of swapping raw values", () => {
    // After a delete + append: B(1), C(2), D(3). "Move D up" must yield
    // B, D, C with dense positions — a raw swap would tie B and D at 1.
    const gapped = [
      { id: "b", position: 1 },
      { id: "c", position: 2 },
      { id: "d", position: 3 },
    ];
    expect(reorderSiblings(gapped, "d", "up")).toEqual([
      { id: "b", position: 0 },
      { id: "d", position: 1 },
      { id: "c", position: 2 },
    ]);
  });

  it("returns null at the boundaries and for unknown ids", () => {
    expect(reorderSiblings(rows, "a", "up")).toBeNull();
    expect(reorderSiblings(rows, "c", "down")).toBeNull();
    expect(reorderSiblings(rows, "ghost", "up")).toBeNull();
  });
});

describe("courseUploadProblem", () => {
  it("accepts files within the kind's rules", () => {
    expect(courseUploadProblem("video", "video/mp4", 100 * 1024 * 1024)).toBeNull();
    expect(courseUploadProblem("image", "image/webp", 1024)).toBeNull();
    expect(courseUploadProblem("pdf", "application/pdf", 1024)).toBeNull();
  });

  it("rejects wrong mime types per kind", () => {
    expect(courseUploadProblem("video", "video/quicktime", 1024)).toMatch(
      /isn't supported/
    );
    expect(courseUploadProblem("pdf", "image/png", 1024)).toMatch(
      /isn't supported/
    );
  });

  it("rejects oversize and empty files", () => {
    expect(
      courseUploadProblem("image", "image/png", 11 * 1024 * 1024)
    ).toMatch(/Too large/);
    expect(courseUploadProblem("image", "image/png", 0)).toMatch(/empty/);
  });

  it("fileKindOf maps only file-backed kinds", () => {
    expect(fileKindOf("video")).toBe("video");
    expect(fileKindOf("pdf")).toBe("pdf");
    expect(fileKindOf("image")).toBe("image");
    expect(fileKindOf("text")).toBeNull();
    expect(fileKindOf("quiz")).toBeNull();
  });
});

describe("coursePublishProblems", () => {
  const goodQuiz: PublishLesson = {
    id: "q",
    kind: "quiz",
    title: "Check",
    filePath: null,
    questions: [{ optionCount: 4, correctCount: 1 }],
  };
  const goodVideo: PublishLesson = {
    id: "v",
    kind: "video",
    title: "Intro",
    filePath: "courses/x/lessons/y/z.mp4",
    questions: [],
  };

  it("passes a well-formed course", () => {
    expect(
      coursePublishProblems([{ id: "m1", lessons: [goodVideo, goodQuiz] }])
    ).toEqual([]);
  });

  it("requires at least one module and no empty modules", () => {
    expect(coursePublishProblems([])).toEqual(["Add at least one module."]);
    expect(
      coursePublishProblems([{ id: "m1", lessons: [] }])
    ).toEqual(["Module 1 has no lessons."]);
  });

  it("flags file lessons without a confirmed upload", () => {
    const problems = coursePublishProblems([
      { id: "m1", lessons: [{ ...goodVideo, filePath: null }] },
    ]);
    expect(problems).toEqual(['Module 1 · "Intro" has no uploaded file.']);
  });

  it("flags empty quizzes and malformed questions", () => {
    expect(
      coursePublishProblems([
        { id: "m1", lessons: [{ ...goodQuiz, questions: [] }] },
      ])
    ).toEqual(['Module 1 · "Check" has no questions.']);

    const problems = coursePublishProblems([
      {
        id: "m1",
        lessons: [
          {
            ...goodQuiz,
            questions: [
              { optionCount: 1, correctCount: 1 },
              { optionCount: 4, correctCount: 2 },
              { optionCount: 4, correctCount: 0 },
            ],
          },
        ],
      },
    ]);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("question 1");
  });

  it("text lessons need neither file nor questions", () => {
    expect(
      coursePublishProblems([
        {
          id: "m1",
          lessons: [
            { id: "t", kind: "text", title: "Read", filePath: null, questions: [] },
          ],
        },
      ])
    ).toEqual([]);
  });
});
