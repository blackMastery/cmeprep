import { describe, expect, it } from "vitest";
import type { ExamAccess } from "@/lib/entitlements-core";
import {
  stripCitation,
  stripLinks,
  tutorAccessFor,
  tutorCapWindowStart,
  validateQuestion,
  TUTOR_DAILY_CAP,
  TUTOR_MAX_QUESTION_CHARS,
  TUTOR_TRIAL_ALLOWANCE,
  type RawCitation,
} from "@/lib/tutor-core";

const trial: ExamAccess = { kind: "all", reason: "trial", org: null };
const admin: ExamAccess = { kind: "all", reason: "admin", org: null };
const scoped: ExamAccess = { kind: "scoped", examIds: ["e1"], org: null };
const none: ExamAccess = { kind: "none", org: null };

/** A paying org seat with no personal subscription rows — entitlements-core
 * reports this as kind:"none" WITH a rider, and the rider is the grant. */
const orgRider = { orgId: "o1", examIds: ["e1"], allAccess: false };
const orgSeat: ExamAccess = { kind: "none", org: orgRider };
const orgSeatOnTrialRole: ExamAccess = {
  kind: "all",
  reason: "trial",
  org: orgRider,
};

const usage = (usedTotal: number, usedToday: number) => ({
  usedTotal,
  usedToday,
});

describe("validateQuestion", () => {
  it("accepts a real question", () => {
    expect(validateQuestion("What causes hypokalaemia?")).toBeNull();
  });

  it("rejects blank and whitespace-only input on TRIMMED length", () => {
    expect(validateQuestion("")).toMatch(/Type a question/);
    expect(validateQuestion("     ")).toMatch(/Type a question/);
  });

  it("rejects a question over the service's own ceiling", () => {
    expect(validateQuestion("x".repeat(TUTOR_MAX_QUESTION_CHARS))).toBeNull();
    expect(validateQuestion("x".repeat(TUTOR_MAX_QUESTION_CHARS + 1))).toMatch(
      /under/
    );
  });
});

describe("tutorCapWindowStart", () => {
  it("is the same instant for two times in one Guyana day", () => {
    const a = tutorCapWindowStart(new Date("2026-08-18T05:00:00Z"));
    const b = tutorCapWindowStart(new Date("2026-08-18T20:00:00Z"));
    expect(a).toBe(b);
  });

  it("rolls over at Guyana midnight, not UTC midnight", () => {
    // Guyana is UTC-4, so 02:00 UTC is still the previous civil day.
    const lateUtc = tutorCapWindowStart(new Date("2026-08-19T02:00:00Z"));
    const sameDay = tutorCapWindowStart(new Date("2026-08-18T20:00:00Z"));
    expect(lateUtc).toBe(sameDay);

    const nextDay = tutorCapWindowStart(new Date("2026-08-19T05:00:00Z"));
    expect(nextDay).not.toBe(sameDay);
  });
});

describe("tutorAccessFor", () => {
  it("leaves admins unmetered even past every limit", () => {
    const verdict = tutorAccessFor(
      "admin",
      admin,
      usage(10_000, 10_000)
    );
    expect(verdict).toEqual({ allowed: true, remaining: null, limit: null });
  });

  it("meters trial users on their LIFETIME total, not the day", () => {
    // Well over the daily cap today, but still inside the trial allowance:
    // the two counters must never be compared against the same limit.
    const fresh = tutorAccessFor("trial", trial, usage(3, 999));
    expect(fresh).toEqual({
      allowed: true,
      remaining: TUTOR_TRIAL_ALLOWANCE - 3,
      limit: TUTOR_TRIAL_ALLOWANCE,
    });
  });

  it("blocks a trial user at the allowance, and stays blocked past it", () => {
    for (const used of [TUTOR_TRIAL_ALLOWANCE, TUTOR_TRIAL_ALLOWANCE + 5]) {
      const verdict = tutorAccessFor("trial", trial, usage(used, 0));
      expect(verdict.allowed).toBe(false);
      if (!verdict.allowed) expect(verdict.reason).toBe("trial_exhausted");
    }
  });

  it("lets a paying org seat through despite kind:\"none\"", () => {
    // The bug this guards: `kind === "none"` reads as "no subscription", but
    // a seat holder with no personal rows lands there WITH a rider. Treating
    // that as no_access locks out every member of every org that buys seats.
    const verdict = tutorAccessFor("student", orgSeat, usage(0, 3));
    expect(verdict).toEqual({
      allowed: true,
      remaining: TUTOR_DAILY_CAP - 3,
      limit: TUTOR_DAILY_CAP,
    });
  });

  it("does not meter an org seat on the trial allowance", () => {
    // An org member whose role is still `trial` has a paid seat; charging
    // them the 10-question lifetime budget would cut them off in a day.
    const verdict = tutorAccessFor(
      "trial",
      orgSeatOnTrialRole,
      usage(TUTOR_TRIAL_ALLOWANCE + 50, 2)
    );
    expect(verdict).toEqual({
      allowed: true,
      remaining: TUTOR_DAILY_CAP - 2,
      limit: TUTOR_DAILY_CAP,
    });
  });

  it("locks a student with no exam access and no org rider", () => {
    const verdict = tutorAccessFor("student", none, usage(0, 0));
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toBe("no_access");
  });

  it("meters an entitled student on the DAY, not their lifetime total", () => {
    const verdict = tutorAccessFor("student", scoped, usage(5_000, 4));
    expect(verdict).toEqual({
      allowed: true,
      remaining: TUTOR_DAILY_CAP - 4,
      limit: TUTOR_DAILY_CAP,
    });
  });

  it("blocks an entitled student at the daily cap", () => {
    const verdict = tutorAccessFor("student", scoped, usage(0, TUTOR_DAILY_CAP));
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toBe("daily_cap");
  });

  it("treats a legacy all-access student as entitled, not as a trial", () => {
    const legacy: ExamAccess = { kind: "all", reason: "legacy", org: null };
    const verdict = tutorAccessFor("student", legacy, usage(500, 0));
    expect(verdict).toEqual({
      allowed: true,
      remaining: TUTOR_DAILY_CAP,
      limit: TUTOR_DAILY_CAP,
    });
  });
});

describe("stripCitation", () => {
  const raw: RawCitation = {
    n: 1,
    file_name: "Merck Manual.pdf",
    page: 412,
    link: "https://drive.google.com/file/d/abc123/view",
    kind: "figure",
    image_url: "https://example.supabase.co/study-images/x.png",
  };

  it("drops the Drive link and keeps the attribution", () => {
    const clean = stripCitation(raw);
    expect(clean).not.toHaveProperty("link");
    expect(JSON.stringify(clean)).not.toContain("drive.google.com");
    expect(clean).toEqual({
      n: 1,
      file_name: "Merck Manual.pdf",
      page: 412,
      kind: "figure",
      image_url: "https://example.supabase.co/study-images/x.png",
    });
  });

  it("normalises missing optional fields rather than emitting undefined", () => {
    const clean = stripCitation({
      n: 2,
      file_name: "Notes.docx",
      page: null,
      link: null,
    } as RawCitation);
    expect(clean).toEqual({
      n: 2,
      file_name: "Notes.docx",
      page: null,
      kind: "text",
      image_url: null,
    });
  });
});

describe("stripLinks (the SSE rewriter)", () => {
  const encoder = new TextEncoder();

  /** Feed the transform arbitrary byte slices and collect what comes out. */
  async function pump(chunks: string[]): Promise<string> {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
    const out: string[] = [];
    const decoder = new TextDecoder();
    for await (const piece of stream.pipeThrough(stripLinks()) as unknown as AsyncIterable<Uint8Array>) {
      out.push(decoder.decode(piece));
    }
    return out.join("");
  }

  const doneFrame = (link: string) =>
    `data: ${JSON.stringify({
      done: true,
      citations: [
        { n: 1, file_name: "Merck Manual.pdf", page: 412, link, kind: "text", image_url: null },
      ],
    })}\n\n`;

  const DRIVE = "https://drive.google.com/file/d/SECRET/view";

  it("removes the Drive link from the done frame", async () => {
    const out = await pump([`data: {"token":"hi"}\n\n`, doneFrame(DRIVE)]);
    expect(out).not.toContain("drive.google.com");
    expect(out).toContain("Merck Manual.pdf");
    expect(out).toContain(`"token":"hi"`);
  });

  it("still strips when the done frame is split across network chunks", async () => {
    // The whole point of buffering: a chunk boundary inside the JSON must not
    // let an unparsed frame through untouched.
    const frame = doneFrame(DRIVE);
    for (const cut of [5, 20, frame.length - 30, frame.length - 3]) {
      const out = await pump([frame.slice(0, cut), frame.slice(cut)]);
      expect(out).not.toContain("drive.google.com");
      expect(JSON.parse(out.slice(5).trim()).citations[0]).not.toHaveProperty("link");
    }
  });

  it("strips a final frame that arrives without a trailing separator", async () => {
    // Exercises the flush path rather than the transform path.
    const out = await pump([doneFrame(DRIVE).replace(/\n\n$/, "")]);
    expect(out).not.toContain("drive.google.com");
    expect(out.endsWith("\n\n")).toBe(true);
  });

  it("passes token and error frames through unchanged", async () => {
    const out = await pump([
      `data: {"token":"a"}\n\n`,
      `data: {"error":"nope"}\n\n`,
    ]);
    expect(out).toBe(`data: {"token":"a"}\n\ndata: {"error":"nope"}\n\n`);
  });

  it("DROPS a frame truncated mid-JSON instead of forwarding the prefix", async () => {
    // The upstream stream dying mid-frame is routine — a Render cold start
    // drops in-flight SSE. The leftover buffer is a partial done frame whose
    // prefix still contains the Drive URL, so forwarding it would leak the
    // one thing this function exists to remove.
    const frame = doneFrame(DRIVE);
    const out = await pump([frame.slice(0, 110)]);
    expect(out).not.toContain("drive.google.com");
    expect(out).toBe("");
  });

  it("drops any unparseable data frame", async () => {
    expect(await pump([`data: not json\n\n`])).toBe("");
  });

  it("passes non-data lines through untouched", async () => {
    expect(await pump([`: heartbeat\n\n`])).toBe(`: heartbeat\n\n`);
  });
});
