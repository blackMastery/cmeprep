import { describe, expect, it } from "vitest";
import {
  CERT_CODE_ALPHABET,
  certificateEligibility,
  certificateFilename,
  fitTextSize,
  formatCertificateCode,
  formatCertificateDate,
  parseCertificateCode,
  toPrintableText,
  truncateToWidth,
} from "@/lib/certificates-core";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("formatCertificateCode", () => {
  it("formats ten symbols as CME-XXXXX-XXXXX", () => {
    const code = formatCertificateCode(bytes(0, 1, 2, 3, 4, 5, 6, 7, 8, 9));
    expect(code).toBe("CME-01234-56789");
  });

  it("wraps bytes into the alphabet without bias (256/32 divides exactly)", () => {
    // 32 and 0 must land on the same symbol; 33 and 1 likewise.
    expect(formatCertificateCode(bytes(32, 33, 255, 0, 0, 0, 0, 0, 0, 0))).toBe(
      `CME-${CERT_CODE_ALPHABET[0]}${CERT_CODE_ALPHABET[1]}${CERT_CODE_ALPHABET[31]}00-00000`
    );
  });

  it("never emits an ambiguous glyph", () => {
    const code = formatCertificateCode(
      new Uint8Array(Array.from({ length: 10 }, (_, i) => i * 7))
    );
    expect(code).not.toMatch(/[ILOU]/);
  });

  it("refuses to build a code from too little randomness", () => {
    expect(() => formatCertificateCode(bytes(1, 2, 3))).toThrow();
  });
});

describe("parseCertificateCode", () => {
  const canonical = "CME-7K2M9-QX4PD";

  it("round-trips a generated code", () => {
    const code = formatCertificateCode(bytes(0, 1, 2, 3, 4, 5, 6, 7, 8, 9));
    expect(parseCertificateCode(code)).toBe(code);
  });

  it("accepts lowercase, spacing and missing hyphens", () => {
    expect(parseCertificateCode("cme7k2m9qx4pd")).toBe(canonical);
    expect(parseCertificateCode("  CME 7K2M9 QX4PD  ")).toBe(canonical);
    expect(parseCertificateCode("cme-7k2m9-qx4pd")).toBe(canonical);
  });

  it("accepts the bare code without the CME prefix", () => {
    expect(parseCertificateCode("7K2M9QX4PD")).toBe(canonical);
  });

  it("repairs the Crockford confusables a reader would mistype", () => {
    // O read as zero, I and L read as one.
    expect(parseCertificateCode("CME-O1234-5678I")).toBe("CME-01234-56781");
    expect(parseCertificateCode("CME-L1234-56789")).toBe("CME-11234-56789");
  });

  it("keeps a bare code whose own body starts with C, M, E", () => {
    // formatCertificateCode can emit CME-CME12-34567. Stripping the prefix
    // without a length guard would eat the body's own leading letters.
    expect(parseCertificateCode("CME1234567")).toBe("CME-CME12-34567");
    expect(parseCertificateCode("CME-CME12-34567")).toBe("CME-CME12-34567");
  });

  it("rejects wrong lengths and out-of-alphabet input", () => {
    expect(parseCertificateCode("CME-7K2M9-QX4P")).toBeNull();
    expect(parseCertificateCode("CME-7K2M9-QX4PDD")).toBeNull();
    expect(parseCertificateCode("")).toBeNull();
    // U is excluded from the alphabet and has no repair mapping.
    expect(parseCertificateCode("CME-U1234-56789")).toBeNull();
  });
});

describe("certificateEligibility", () => {
  const base = {
    totalLessons: 4,
    completedLessons: 4,
    quizLessonIds: ["q1", "q2"],
    passedQuizLessonIds: new Set(["q1", "q2"]),
  };

  it("passes a fully completed course", () => {
    expect(certificateEligibility(base)).toEqual({ eligible: true });
  });

  it("refuses a course with no lessons", () => {
    const result = certificateEligibility({
      ...base,
      totalLessons: 0,
      completedLessons: 0,
      quizLessonIds: [],
    });
    expect(result.eligible).toBe(false);
  });

  it("refuses an unfinished course", () => {
    expect(
      certificateEligibility({ ...base, completedLessons: 3 }).eligible
    ).toBe(false);
  });

  it("refuses when a quiz was never passed, even at 100% lessons", () => {
    // The case the redundant check exists for: progress rows written by
    // something other than a passing attempt.
    const result = certificateEligibility({
      ...base,
      passedQuizLessonIds: new Set(["q1"]),
    });
    expect(result).toEqual({
      eligible: false,
      reason: "Pass every quiz in the course first.",
    });
  });

  it("passes a quiz-free course that is fully complete", () => {
    expect(
      certificateEligibility({
        ...base,
        quizLessonIds: [],
        passedQuizLessonIds: new Set(),
      }).eligible
    ).toBe(true);
  });
});

describe("formatCertificateDate", () => {
  it("renders in UTC regardless of the running timezone", () => {
    // 00:30 UTC is the previous day in the Americas — the certificate, the
    // list page and /verify must still agree.
    expect(formatCertificateDate("2026-08-18T00:30:00Z")).toBe(
      "18 August 2026"
    );
  });
});

describe("certificateFilename", () => {
  it("slugs the course title", () => {
    expect(certificateFilename("Acute Coronary Syndromes", "CME-01234-56789"))
      .toBe("cmeprep-certificate-acute-coronary-syndromes-CME-01234-56789.pdf");
  });

  it("survives a title with no usable characters", () => {
    expect(certificateFilename("!!!", "CME-01234-56789")).toBe(
      "cmeprep-certificate-course-CME-01234-56789.pdf"
    );
  });

  it("never leaves a trailing hyphen after truncation", () => {
    const name = certificateFilename(`${"a".repeat(59)} tail`, "C");
    expect(name).not.toContain("--");
    expect(name).toMatch(/^cmeprep-certificate-a{59}-C\.pdf$/);
  });
});

describe("fitTextSize", () => {
  // Pretend every glyph is half the font size wide.
  const measureFor = (text: string) => (size: number) =>
    text.length * size * 0.5;

  it("keeps the largest size that fits", () => {
    expect(fitTextSize(measureFor("Dr Jane Smith"), 130, 40, 16)).toBe(20);
  });

  it("bottoms out at minSize rather than shrinking forever", () => {
    expect(fitTextSize(measureFor("x".repeat(500)), 100, 40, 16)).toBe(16);
  });

  it("uses maxSize when there is room to spare", () => {
    expect(fitTextSize(measureFor("Jo"), 1000, 40, 16)).toBe(40);
  });
});

describe("truncateToWidth", () => {
  const measure = (text: string) => text.length * 10;

  it("leaves text that already fits", () => {
    expect(truncateToWidth("abc", measure, 100)).toBe("abc");
  });

  it("ellipsises text that cannot fit at all", () => {
    expect(truncateToWidth("abcdefgh", measure, 50)).toBe("abcd…");
  });
});

describe("toPrintableText", () => {
  // The PDF standard-14 fonts encode WinAnsi only; pdf-lib throws on the rest.
  it("leaves plain ASCII untouched", () => {
    expect(toPrintableText("Dr. Jane Smith, MBBS")).toBe("Dr. Jane Smith, MBBS");
  });

  it("keeps accents that WinAnsi already covers", () => {
    expect(toPrintableText("Dr. José Müller-Nuñez Ørsted Æsir")).toBe(
      "Dr. José Müller-Nuñez Ørsted Æsir"
    );
  });

  it("strips accents it cannot encode rather than dropping the letter", () => {
    // Latin Extended-A: ā, ș, ū decompose to a base letter plus a mark.
    expect(toPrintableText("Dr. Ānand Ștefan Ūlfr")).toBe(
      "Dr. Anand Stefan Ulfr"
    );
  });

  it("transliterates letters with no decomposition", () => {
    expect(toPrintableText("Dr. Łukasz Wójcik")).toBe("Dr. Lukasz Wójcik");
    expect(toPrintableText("Đorđe")).toBe("Dorde");
  });

  it("returns empty for a name in a script it cannot represent", () => {
    // The caller must treat this as unprintable, not draw a blank name.
    expect(toPrintableText("陳大文")).toBe("");
    expect(toPrintableText("Александр")).toBe("");
  });

  it("collapses the whitespace left behind by dropped characters", () => {
    expect(toPrintableText("Dr. 陳 Smith")).toBe("Dr. Smith");
  });
});
