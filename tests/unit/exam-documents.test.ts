import { describe, expect, it } from "vitest";
import {
  documentKindLabel,
  examDocumentUploadProblem,
  formatFileSize,
} from "@/lib/exam-documents-core";
import {
  EXAM_DOCUMENT_RULES,
  examDocumentContentType,
  examDocumentExtensionForType,
  examDocumentPathExamId,
  isExamDocumentPath,
} from "@/lib/storage";
import {
  canAccessExam,
  examDocumentAccessFor,
  type OrgGrantContext,
  type SubscriptionScope,
} from "@/lib/entitlements-core";

const PDF = "application/pdf";
const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// The seed exam id is not RFC-v4 — kept here so the fixtures match reality.
const EXAM_A = "e0000000-0000-0000-0000-000000000001";
const EXAM_B = "e0000000-0000-0000-0000-000000000002";
const ORG_1 = "a0000000-0000-0000-0000-000000000001";
const ORG_2 = "a0000000-0000-0000-0000-000000000002";
const DOC_UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

describe("examDocumentUploadProblem", () => {
  it("accepts every mime the bucket allows", () => {
    for (const mime of EXAM_DOCUMENT_RULES.mimes) {
      expect(examDocumentUploadProblem(mime, 1024)).toBeNull();
    }
  });

  it("rejects a mime outside the allowlist", () => {
    expect(examDocumentUploadProblem("application/zip", 1024)).toMatch(
      /isn't supported/
    );
    expect(examDocumentUploadProblem("video/mp4", 1024)).toMatch(
      /isn't supported/
    );
  });

  // A failed File.size read looks like 0 or NaN, and a bare `size > max`
  // comparison passes both — hence the explicit branch in the core.
  it("rejects an empty or unreadable size", () => {
    expect(examDocumentUploadProblem(PDF, 0)).toBe("That file looks empty.");
    expect(examDocumentUploadProblem(PDF, NaN)).toBe("That file looks empty.");
    expect(examDocumentUploadProblem(PDF, -1)).toBe("That file looks empty.");
  });

  it("rejects a file over the 50 MB ceiling but accepts one exactly at it", () => {
    const max = EXAM_DOCUMENT_RULES.maxBytes;
    expect(examDocumentUploadProblem(PDF, max)).toBeNull();
    expect(examDocumentUploadProblem(PDF, max + 1)).toMatch(/Too large/);
  });
});

describe("examDocumentContentType", () => {
  it("keeps a content type the allowlist already accepts", () => {
    expect(examDocumentContentType({ type: PDF, name: "syllabus.pdf" })).toBe(
      PDF
    );
  });

  // The whole reason this helper exists: browsers report "" (or something
  // wrong) for Office files often enough that trusting File.type drops
  // legitimate uploads.
  it("falls back to the extension when the browser reports nothing", () => {
    expect(
      examDocumentContentType({ type: "", name: "Blueprint.docx" })
    ).toBe(DOCX);
    expect(
      examDocumentContentType({ type: "", name: "weighting.XLSX" })
    ).toBe(XLSX);
  });

  it("normalises .jpeg to the jpg mapping", () => {
    expect(examDocumentContentType({ type: "", name: "scan.jpeg" })).toBe(
      "image/jpeg"
    );
  });

  it("returns null when neither the type nor the extension is allowed", () => {
    expect(examDocumentContentType({ type: "", name: "notes.zip" })).toBeNull();
    expect(examDocumentContentType({ type: "", name: "noextension" })).toBeNull();
  });

  /**
   * The resolved type has to reach the BYTES, not just the row. storage-js
   * sends a Blob body as a FormData part and ignores fileOptions.contentType,
   * so the part carries File.type — an uncorrected "" arrives as
   * application/octet-stream and the bucket rejects it with a 415. The
   * uploader therefore re-wraps the File; this pins that the re-wrapped blob
   * carries a type the bucket actually allows.
   */
  it("produces a blob type the bucket accepts when the browser reported none", () => {
    const picked = { type: "", name: "Blueprint.docx" };
    const resolved = examDocumentContentType(picked);
    expect(resolved).not.toBeNull();

    const uploaded = new File([new Blob(["x"])], picked.name, {
      type: picked.type === resolved ? picked.type : (resolved as string),
    });
    expect(uploaded.type).toBe(DOCX);
    expect(EXAM_DOCUMENT_RULES.mimes).toContain(uploaded.type);
    expect(uploaded.type).not.toBe("application/octet-stream");
  });
});

describe("examDocumentExtensionForType", () => {
  it("maps every allowed mime to an extension the path regex accepts", () => {
    for (const mime of EXAM_DOCUMENT_RULES.mimes) {
      const ext = examDocumentExtensionForType(mime);
      expect(ext).not.toBeNull();
      expect(
        isExamDocumentPath(`exams/${EXAM_A}/${DOC_UUID}.${ext}`)
      ).toBe(true);
    }
  });

  it("returns null for anything else", () => {
    expect(examDocumentExtensionForType("application/zip")).toBeNull();
  });
});

describe("isExamDocumentPath", () => {
  it("accepts a path of the shape the mint action produces", () => {
    expect(isExamDocumentPath(`exams/${EXAM_A}/${DOC_UUID}.pdf`)).toBe(true);
  });

  // The validator is load-bearing: these paths are read with the service-role
  // client, which ignores RLS.
  it("rejects traversal and absolute paths", () => {
    expect(isExamDocumentPath("exams/../../secret.pdf")).toBe(false);
    expect(isExamDocumentPath(`/exams/${EXAM_A}/${DOC_UUID}.pdf`)).toBe(false);
    expect(
      isExamDocumentPath(`exams/${EXAM_A}/../${DOC_UUID}.pdf`)
    ).toBe(false);
  });

  it("rejects another bucket's path shape", () => {
    expect(isExamDocumentPath(`courses/${EXAM_A}/cover/${DOC_UUID}.pdf`)).toBe(
      false
    );
    expect(isExamDocumentPath(`imports/${DOC_UUID}.xlsx`)).toBe(false);
    expect(isExamDocumentPath(`q/${DOC_UUID}.png`)).toBe(false);
  });

  it("rejects a loose hex blob that is not the 8-4-4-4-12 layout", () => {
    expect(
      isExamDocumentPath(`exams/${EXAM_A}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf`)
    ).toBe(false);
  });

  it("rejects a disallowed extension and a missing one", () => {
    expect(isExamDocumentPath(`exams/${EXAM_A}/${DOC_UUID}.exe`)).toBe(false);
    expect(isExamDocumentPath(`exams/${EXAM_A}/${DOC_UUID}`)).toBe(false);
  });

  it("rejects extra path segments", () => {
    expect(
      isExamDocumentPath(`exams/${EXAM_A}/nested/${DOC_UUID}.pdf`)
    ).toBe(false);
  });
});

describe("examDocumentPathExamId", () => {
  it("names the exam a valid path is filed under", () => {
    expect(examDocumentPathExamId(`exams/${EXAM_A}/${DOC_UUID}.pdf`)).toBe(
      EXAM_A
    );
  });

  // This is what stops a well-formed path for exam B being filed under A.
  it("returns null for a path the mint action never produced", () => {
    expect(examDocumentPathExamId("exams/../../x.pdf")).toBeNull();
  });
});

// ── the paid-access rule ────────────────────────────────────

const NOW = new Date("2026-07-23T12:00:00Z");
const FUTURE = "2026-10-01T12:00:00Z";
const PAST = "2026-07-01T12:00:00Z";

const sub = (
  examId: string | null,
  end: string,
  status: SubscriptionScope["status"] = "active"
): SubscriptionScope => ({
  exam_id: examId,
  status,
  current_period_end: end,
});

const org = (over: Partial<OrgGrantContext> = {}): OrgGrantContext => ({
  org_id: ORG_1,
  suspended_at: null,
  subs: [sub(EXAM_A, FUTURE)],
  ...over,
});

/** Reads as the call site does: access for `role`, then the per-exam check. */
const may = (
  role: Parameters<typeof examDocumentAccessFor>[0],
  subs: SubscriptionScope[],
  orgCtx: OrgGrantContext | null,
  exam: { id: string; orgId: string | null }
) => canAccessExam(examDocumentAccessFor(role, subs, orgCtx, NOW), exam);

const publicExam = (id: string) => ({ id, orgId: null });

describe("examDocumentAccessFor", () => {
  it("locks a trial user out — a practice allowance does not buy the syllabus", () => {
    expect(may("trial", [], null, publicExam(EXAM_A))).toBe(false);
    expect(may("trial", [], null, publicExam(EXAM_B))).toBe(false);
  });

  // The reason the rule is a role COERCION and not a role check: a trial-role
  // user who has just paid must not be locked out of what they bought while
  // the role sync catches up.
  it("gives a trial user the exam they have just bought, and only that one", () => {
    const subs = [sub(EXAM_A, FUTURE)];
    expect(may("trial", subs, null, publicExam(EXAM_A))).toBe(true);
    expect(may("trial", subs, null, publicExam(EXAM_B))).toBe(false);
  });

  it("scopes a student to the exams their live rows name", () => {
    const subs = [sub(EXAM_A, FUTURE)];
    expect(may("student", subs, null, publicExam(EXAM_A))).toBe(true);
    expect(may("student", subs, null, publicExam(EXAM_B))).toBe(false);
  });

  it("honours a grandfathered all-access row", () => {
    const subs = [sub(null, FUTURE)];
    expect(may("student", subs, null, publicExam(EXAM_A))).toBe(true);
    expect(may("student", subs, null, publicExam(EXAM_B))).toBe(true);
  });

  // isEffectivelyActive, not the stored status: nothing flips lapsed rows.
  it("ignores a row whose period has ended even though it still says active", () => {
    expect(may("student", [sub(EXAM_A, PAST)], null, publicExam(EXAM_A))).toBe(
      false
    );
  });

  it("ignores a cancelled row inside its period", () => {
    expect(
      may("student", [sub(EXAM_A, FUTURE, "cancelled")], null, publicExam(EXAM_A))
    ).toBe(false);
  });

  it("keeps admins unrestricted so they can QA what they publish", () => {
    expect(may("admin", [], null, publicExam(EXAM_A))).toBe(true);
    expect(may("admin", [], null, { id: EXAM_B, orgId: ORG_2 })).toBe(true);
  });

  it("covers an org member for the exams their org bought", () => {
    expect(may("student", [], org(), publicExam(EXAM_A))).toBe(true);
    expect(may("student", [], org(), publicExam(EXAM_B))).toBe(false);
  });

  it("opens the org's own private bank to its members", () => {
    expect(may("student", [], org(), { id: EXAM_B, orgId: ORG_1 })).toBe(true);
  });

  // The org wall: no breadth of public access ever crosses it.
  it("never lets one org read another org's private bank", () => {
    expect(may("student", [], org(), { id: EXAM_B, orgId: ORG_2 })).toBe(false);
    expect(
      may("student", [sub(null, FUTURE)], null, { id: EXAM_B, orgId: ORG_2 })
    ).toBe(false);
  });

  it("grants nothing through a suspended org", () => {
    expect(
      may("student", [], org({ suspended_at: PAST }), publicExam(EXAM_A))
    ).toBe(false);
  });

  it("covers a trial-role org member for what the org bought", () => {
    expect(may("trial", [], org(), publicExam(EXAM_A))).toBe(true);
    expect(may("trial", [], org(), publicExam(EXAM_B))).toBe(false);
  });
});

describe("formatFileSize", () => {
  it("scales through the units", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1024 * 1024 * 2.5)).toBe("2.5 MB");
    expect(formatFileSize(1024 * 1024 * 42)).toBe("42 MB");
  });

  it("does not print a bogus size", () => {
    expect(formatFileSize(0)).toBe("—");
    expect(formatFileSize(NaN)).toBe("—");
  });
});

describe("documentKindLabel", () => {
  it("labels each family the uploader accepts", () => {
    expect(documentKindLabel(PDF)).toBe("PDF");
    expect(documentKindLabel(DOCX)).toBe("Word");
    expect(documentKindLabel("application/msword")).toBe("Word");
    expect(documentKindLabel(XLSX)).toBe("Excel");
    expect(documentKindLabel("application/vnd.ms-excel")).toBe("Excel");
    expect(
      documentKindLabel(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      )
    ).toBe("PowerPoint");
    expect(documentKindLabel("image/png")).toBe("Image");
  });
});
