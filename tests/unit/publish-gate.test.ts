import { describe, expect, it } from "vitest";
import { publishBlocker, type PublishCandidate } from "@/lib/admin/publish-gate";

function candidate(overrides: Partial<PublishCandidate> = {}): PublishCandidate {
  return {
    type: "mcq_single",
    image_path: null,
    optionCount: 4,
    correctCount: 1,
    ...overrides,
  };
}

describe("publishBlocker", () => {
  it("clears a well-formed single-answer question", () => {
    expect(publishBlocker(candidate())).toBeNull();
  });

  it("clears a multi-answer question with two correct options", () => {
    expect(
      publishBlocker(candidate({ type: "mcq_multi", correctCount: 2 }))
    ).toBeNull();
  });

  it("clears an image question that has an image", () => {
    expect(
      publishBlocker(candidate({ type: "image_based", image_path: "q/a.png" }))
    ).toBeNull();
  });

  it("blocks a question with fewer than two options", () => {
    expect(publishBlocker(candidate({ optionCount: 1 }))).toBe(
      "Add at least two options before publishing."
    );
  });

  it("blocks a question with no options at all", () => {
    expect(publishBlocker(candidate({ optionCount: 0, correctCount: 0 }))).toBe(
      "Add at least two options before publishing."
    );
  });

  it("blocks a multi-answer question with only one correct option", () => {
    expect(
      publishBlocker(candidate({ type: "mcq_multi", correctCount: 1 }))
    ).toBe("Multi-answer questions need at least two correct options.");
  });

  it("blocks a single-answer question with no correct option", () => {
    expect(publishBlocker(candidate({ correctCount: 0 }))).toBe(
      "Mark exactly one option correct before publishing."
    );
  });

  it("blocks a single-answer question with two correct options", () => {
    expect(publishBlocker(candidate({ correctCount: 2 }))).toBe(
      "Mark exactly one option correct before publishing."
    );
  });

  it("treats image_based as single-answer, not multi", () => {
    expect(
      publishBlocker(
        candidate({ type: "image_based", image_path: "q/a.png", correctCount: 2 })
      )
    ).toBe("Mark exactly one option correct before publishing.");
  });

  it("blocks an image question with no image", () => {
    expect(
      publishBlocker(candidate({ type: "image_based", image_path: null }))
    ).toBe("Image questions need an image before publishing.");
  });

  // Option problems are reported first: fixing the answer key is the harder
  // job, and an image upload is meaningless while the key is still broken.
  it("reports the option problem before the missing image", () => {
    expect(
      publishBlocker(
        candidate({ type: "image_based", image_path: null, optionCount: 1 })
      )
    ).toBe("Add at least two options before publishing.");
  });
});
