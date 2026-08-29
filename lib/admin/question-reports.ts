import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { ContentScope } from "@/lib/admin/content-scope";
import type {
  QuestionReport,
  QuestionReportCategory,
  QuestionReportResolution,
} from "@/lib/supabase/types";
import {
  lastRuling,
  rankRollups,
  reportRate,
  splitPicks,
  type PickSplit,
} from "@/lib/question-reports-core";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Triage side of question reports (question-reports-spec.md §3). Rollup,
 * not a feed: one row per reported question, with the evidence an admin
 * needs to rule on it in place.
 *
 * Org scoping happens AT QUERY TIME through the taxonomy embed — the org
 * filter is the same `subjects.specialties.exams.org_id` pin content-scope
 * uses — so an org never reads another bank's rows, and the read bound
 * below is per scope rather than platform-wide.
 */

export const REPORT_QUEUE_LIMIT = 100;

/** Report rows read per view. Rollups need every open row on a question to
 * count reporters, so this bounds the QUESTIONS a queue can rank; anything
 * past it is logged below rather than silently dropped. */
const REPORT_ROWS_LIMIT = 5000;

/** PostgREST `.in()` rides the URL; keep each request well under limits. */
const IN_CHUNK = 200;

export type ReporterNote = {
  reportId: string;
  userName: string;
  /** Identified, like the OSCE queue: needed to spot a serial reporter and
   * to follow up on a genuinely good catch. */
  email: string | null;
  category: QuestionReportCategory | null;
  note: string | null;
  /** Translation on screen when filed (the 'translation' category). */
  language: string | null;
  createdAt: string;
};

export type Ruling = {
  resolution: QuestionReportResolution;
  note: string | null;
  resolvedAt: string;
  resolvedBy: string;
};

export type ReportRollup = {
  questionId: string;
  stem: string;
  explanation: string;
  imagePath: string | null;
  subjectName: string;
  examName: string;
  isPublished: boolean;
  deletedAt: string | null;
  /** The pick-split boundary (content edits only). */
  contentUpdatedAt: string | null;
  reporters: number;
  attempts: number;
  /** Null below any attempts; displayed alongside the count regardless. */
  rate: number | null;
  /** Distinct reporters by category — bare taps count under "bare". */
  categories: Partial<Record<QuestionReportCategory | "bare", number>>;
  reports: ReporterNote[];
  picks: PickSplit;
  /** Carried forward when a resolved question is reported again. */
  previousRuling: Ruling | null;
  /** Resolved view only: the ruling these rows were closed under. */
  ruling: Ruling | null;
};

/** One source of truth for the row shape: the DB type plus the embeds. */
type ReportJoin = Omit<QuestionReport, "test_id"> & {
  profiles: { full_name: string | null } | null;
};

type QuestionJoin = {
  id: string;
  stem: string;
  explanation: string;
  image_path: string | null;
  is_published: boolean;
  deleted_at: string | null;
  content_updated_at: string | null;
  subjects: {
    name: string;
    specialties: { exams: { name: string } };
  } | null;
};

const REPORT_COLUMNS =
  "id, question_id, user_id, category, note, language, created_at, resolved_at, resolved_by, resolution, resolution_note, profiles!question_reports_user_id_fkey(full_name)";

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Chunked `.in()` read that surfaces errors instead of returning []. */
async function inChunks<Row>(
  ids: string[],
  read: (ids: string[]) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>
): Promise<Row[]> {
  const results = await Promise.all(chunk(ids, IN_CHUNK).map((c) => read(c)));
  const rows: Row[] = [];
  for (const r of results) {
    if (r.error) throw new Error(`question reports read failed: ${r.error.message}`);
    rows.push(...(r.data ?? []));
  }
  return rows;
}

/**
 * Report rows for a view, scoped at query time. The `questions!inner(...)`
 * embed with the org filter is what walls the org view; platform scope
 * reads everything.
 */
async function readReportRows(
  admin: Admin,
  scope: ContentScope,
  view: "open" | "resolved"
): Promise<ReportJoin[]> {
  let query = admin
    .from("question_reports")
    .select(
      `${REPORT_COLUMNS}, questions!inner(subjects!inner(specialties!inner(exams!inner(org_id))))`
    )
    .limit(REPORT_ROWS_LIMIT);
  if (scope.kind === "org") {
    query = query.eq(
      "questions.subjects.specialties.exams.org_id",
      scope.orgId
    );
  }
  query =
    view === "open"
      ? query.is("resolved_at", null).order("created_at", { ascending: false })
      : query
          .not("resolved_at", "is", null)
          .order("resolved_at", { ascending: false })
          .order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) throw new Error(`could not read question reports: ${error.message}`);
  const rows = (data ?? []) as unknown as ReportJoin[];
  if (rows.length === REPORT_ROWS_LIMIT) {
    // No silent caps: the oldest rows past this bound are not ranked.
    console.warn("question_reports_queue_truncated", { scope: scope.kind, view });
  }
  return rows;
}

async function questionsById(
  admin: Admin,
  ids: string[]
): Promise<Map<string, QuestionJoin>> {
  const rows = await inChunks<QuestionJoin>(ids, (c) =>
    admin
      .from("questions")
      .select(
        "id, stem, explanation, image_path, is_published, deleted_at, content_updated_at, subjects(name, specialties(exams(name)))"
      )
      .in("id", c) as unknown as PromiseLike<{
      data: QuestionJoin[] | null;
      error: { message: string } | null;
    }>
  );
  return new Map(rows.map((q) => [q.id, q]));
}

async function emailsFor(admin: Admin, userIds: string[]) {
  const rows = await inChunks<{ id: string; email: string | null }>(userIds, (c) =>
    admin.from("user_emails").select("id, email").in("id", c)
  );
  return new Map(rows.map((r) => [r.id, r.email]));
}

async function namesFor(admin: Admin, userIds: string[]) {
  const rows = await inChunks<{ id: string; full_name: string | null }>(userIds, (c) =>
    admin.from("profiles").select("id, full_name").in("id", c)
  );
  return new Map(rows.map((r) => [r.id, r.full_name ?? "Unknown user"]));
}

/** Live attempt counts — cheap, and all the ranking needs. */
async function attemptCountsFor(admin: Admin, questionIds: string[]) {
  const out = new Map<string, { attempts: number; since: number; before: number }>();
  if (questionIds.length === 0) return out;
  const { data, error } = await admin.rpc("question_report_attempt_counts", {
    question_ids: questionIds,
  });
  if (error) throw new Error(`attempt counts failed: ${error.message}`);
  for (const c of data ?? []) {
    out.set(c.question_id, {
      attempts: Number(c.attempts),
      since: Number(c.since_edit),
      before: Number(c.before_edit),
    });
  }
  return out;
}

/**
 * The evidence block for the questions that SURVIVED ranking: per-option
 * picks split at the content edit. Options include retired ones so
 * historical picks of a since-removed option still show on the "before"
 * side.
 */
async function pickSplitsFor(
  admin: Admin,
  questionIds: string[],
  attempts: Map<string, { attempts: number; since: number; before: number }>
): Promise<Map<string, PickSplit>> {
  const picks = new Map<string, PickSplit>();
  if (questionIds.length === 0) return picks;

  const [{ data: pickRows, error: pickError }, options] = await Promise.all([
    admin.rpc("question_report_pick_counts", { question_ids: questionIds }),
    inChunks<{
      id: string;
      question_id: string;
      label: string;
      is_correct: boolean;
      position: number;
      deleted_at: string | null;
    }>(questionIds, (c) =>
      admin
        .from("question_options")
        .select("id, question_id, label, is_correct, position, deleted_at")
        .in("question_id", c)
        .order("position")
    ),
  ]);
  if (pickError) throw new Error(`pick counts failed: ${pickError.message}`);

  const optionsByQuestion = new Map<string, typeof options>();
  for (const o of options) {
    const list = optionsByQuestion.get(o.question_id) ?? [];
    list.push(o);
    optionsByQuestion.set(o.question_id, list);
  }
  const picksByQuestion = new Map<
    string,
    { optionId: string; sinceEdit: boolean; picks: number }[]
  >();
  for (const p of pickRows ?? []) {
    const list = picksByQuestion.get(p.question_id) ?? [];
    list.push({ optionId: p.option_id, sinceEdit: p.since_edit, picks: Number(p.picks) });
    picksByQuestion.set(p.question_id, list);
  }

  for (const id of questionIds) {
    const all = optionsByQuestion.get(id) ?? [];
    const picked = new Set((picksByQuestion.get(id) ?? []).map((p) => p.optionId));
    // Live options always; retired ones only if anyone ever picked them.
    const shown = all
      .filter((o) => o.deleted_at === null || picked.has(o.id))
      .map((o) => ({
        id: o.id,
        label: o.deleted_at ? `${o.label} (retired)` : o.label,
        isCorrect: o.is_correct && o.deleted_at === null,
      }));
    const a = attempts.get(id) ?? { attempts: 0, since: 0, before: 0 };
    picks.set(
      id,
      splitPicks(shown, picksByQuestion.get(id) ?? [], {
        sinceEdit: a.since,
        beforeEdit: a.before,
      })
    );
  }
  return picks;
}

function rulingOf(
  r: Pick<QuestionReport, "resolution" | "resolution_note" | "resolved_at" | "resolved_by">,
  names: Map<string, string>
): Ruling | null {
  if (!r.resolution || !r.resolved_at) return null;
  return {
    resolution: r.resolution,
    note: r.resolution_note,
    resolvedAt: r.resolved_at,
    resolvedBy: r.resolved_by ? (names.get(r.resolved_by) ?? "Unknown admin") : "System",
  };
}

/** Last ruling per question — what an open rollup reopens against. */
async function previousRulingsFor(
  admin: Admin,
  questionIds: string[]
): Promise<Map<string, Ruling>> {
  const out = new Map<string, Ruling>();
  if (questionIds.length === 0) return out;
  const history = await inChunks<
    Pick<QuestionReport, "question_id" | "resolution" | "resolution_note" | "resolved_at" | "resolved_by">
  >(questionIds, (c) =>
    admin
      .from("question_reports")
      .select("question_id, resolution, resolution_note, resolved_at, resolved_by")
      .in("question_id", c)
      .not("resolved_at", "is", null)
      .order("resolved_at", { ascending: false })
  );
  const names = await namesFor(
    admin,
    [...new Set(history.map((h) => h.resolved_by).filter((id): id is string => !!id))]
  );
  const byQuestion = new Map<string, typeof history>();
  for (const h of history) {
    const list = byQuestion.get(h.question_id) ?? [];
    list.push(h);
    byQuestion.set(h.question_id, list);
  }
  for (const [qid, list] of byQuestion) {
    const last = lastRuling(list);
    const ruling = last ? rulingOf(last, names) : null;
    if (ruling) out.set(qid, ruling);
  }
  return out;
}

/**
 * The queue. `open` rolls up every open report per question, ranked by
 * rate with the reporter floor; `resolved` groups past reports by question
 * and the ruling they closed under, newest ruling first. Ranking needs only
 * reporter and attempt counts, so the expensive evidence (pick aggregates,
 * options, emails, history) is fetched for the surviving page alone.
 */
export async function listReportRollups(
  scope: ContentScope,
  view: "open" | "resolved"
): Promise<ReportRollup[]> {
  const admin = createAdminClient();
  const rows = await readReportRows(admin, scope, view);
  if (rows.length === 0) return [];

  // Group per question (and, for the resolved view, per ruling instant so
  // two separate rulings on one question stay two rows).
  const groups = new Map<string, ReportJoin[]>();
  for (const r of rows) {
    const key = view === "open" ? r.question_id : `${r.question_id}|${r.resolved_at}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const allIds = [...new Set(rows.map((r) => r.question_id))];
  const attempts = await attemptCountsFor(admin, allIds);

  type Seed = { key: string; questionId: string; reporters: number; attempts: number };
  const seeds: Seed[] = [...groups].map(([key, reports]) => ({
    key,
    questionId: reports[0].question_id,
    reporters: new Set(reports.map((r) => r.user_id)).size,
    attempts: attempts.get(reports[0].question_id)?.attempts ?? 0,
  }));
  const page =
    view === "open"
      ? rankRollups(seeds).slice(0, REPORT_QUEUE_LIMIT)
      : seeds
          // Rows are already resolved_at desc; groups inherit that order.
          .slice(0, REPORT_QUEUE_LIMIT);

  const pageIds = [...new Set(page.map((s) => s.questionId))];
  const pageReports = page.flatMap((s) => groups.get(s.key) ?? []);
  const reporterIds = [...new Set(pageReports.map((r) => r.user_id))];
  const resolverIds = [
    ...new Set(pageReports.map((r) => r.resolved_by).filter((id): id is string => !!id)),
  ];

  const [questions, picks, emails, names, previous] = await Promise.all([
    questionsById(admin, pageIds),
    pickSplitsFor(admin, pageIds, attempts),
    emailsFor(admin, reporterIds),
    namesFor(admin, resolverIds),
    view === "open" ? previousRulingsFor(admin, pageIds) : new Map<string, Ruling>(),
  ]);

  const rollups: ReportRollup[] = [];
  for (const seed of page) {
    const reports = groups.get(seed.key) ?? [];
    const q = questions.get(seed.questionId);
    if (!q) continue; // FK guarantees presence; defensive for a mid-read delete.

    const categories: ReportRollup["categories"] = {};
    const seen = new Set<string>();
    for (const r of reports) {
      // One vote per reporter per category.
      const c = r.category ?? "bare";
      const k = `${r.user_id}|${c}`;
      if (seen.has(k)) continue;
      seen.add(k);
      categories[c] = (categories[c] ?? 0) + 1;
    }

    rollups.push({
      questionId: seed.questionId,
      stem: q.stem,
      explanation: q.explanation,
      imagePath: q.image_path,
      subjectName: q.subjects?.name ?? "",
      examName: q.subjects?.specialties.exams.name ?? "",
      isPublished: q.is_published,
      deletedAt: q.deleted_at,
      contentUpdatedAt: q.content_updated_at,
      reporters: seed.reporters,
      attempts: seed.attempts,
      rate: reportRate(seed.reporters, seed.attempts),
      categories,
      reports: reports.map((r) => ({
        reportId: r.id,
        userName: r.profiles?.full_name ?? "Unknown user",
        email: emails.get(r.user_id) ?? null,
        category: r.category,
        note: r.note,
        language: r.language,
        createdAt: r.created_at,
      })),
      picks: picks.get(seed.questionId)!,
      previousRuling: previous.get(seed.questionId) ?? null,
      ruling: view === "resolved" ? rulingOf(reports[0], names) : null,
    });
  }
  return rollups;
}

/** Open rollup count for the nav badge — questions, not reports. One
 * integer from SQL; see open_report_question_count in the migration. */
export async function openReportQuestionCount(scope: ContentScope): Promise<number> {
  const { data, error } = await createAdminClient().rpc("open_report_question_count", {
    p_org_id: scope.kind === "org" ? scope.orgId : null,
  });
  if (error) {
    console.error("open_report_question_count_failed", error.message);
    return 0;
  }
  return data ?? 0;
}

export type QuestionReportHistoryRow = ReporterNote & {
  resolvedAt: string | null;
  resolution: QuestionReportResolution | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
};

/**
 * Everything ever reported on one question, newest first — the editor's
 * history. The caller has already pinned the question to its scope.
 */
export async function questionReportHistory(
  questionId: string
): Promise<{ open: number; rows: QuestionReportHistoryRow[] }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("question_reports")
    .select(REPORT_COLUMNS)
    .eq("question_id", questionId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`could not read report history: ${error.message}`);
  const rows = (data ?? []) as unknown as ReportJoin[];
  if (rows.length === 0) return { open: 0, rows: [] };

  const [emails, names] = await Promise.all([
    emailsFor(admin, [...new Set(rows.map((r) => r.user_id))]),
    namesFor(
      admin,
      [...new Set(rows.map((r) => r.resolved_by).filter((id): id is string => !!id))]
    ),
  ]);

  return {
    open: rows.filter((r) => r.resolved_at === null).length,
    rows: rows.map((r) => ({
      reportId: r.id,
      userName: r.profiles?.full_name ?? "Unknown user",
      email: emails.get(r.user_id) ?? null,
      category: r.category,
      note: r.note,
      language: r.language,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      resolution: r.resolution,
      resolutionNote: r.resolution_note,
      resolvedBy: r.resolved_by ? (names.get(r.resolved_by) ?? "Unknown admin") : null,
    })),
  };
}

/**
 * Resolve QUESTIONS: every open report on each closes under one ruling.
 * Returns how many rows closed (0 = nothing was open — someone else got
 * there, and their audit row tells the story). Scope is the caller's job.
 * Throws on a DB error; callers decide whether that is fatal.
 */
export async function resolveOpenReports(
  admin: Admin,
  questionIds: string[],
  input: {
    resolution: QuestionReportResolution;
    note: string | null;
    resolvedBy: string;
  }
): Promise<number> {
  if (questionIds.length === 0) return 0;
  const { data, error } = await admin
    .from("question_reports")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: input.resolvedBy,
      resolution: input.resolution,
      resolution_note: input.note,
    })
    .in("question_id", questionIds)
    .is("resolved_at", null)
    .select("id");
  if (error) throw new Error(`could not resolve reports: ${error.message}`);
  return data?.length ?? 0;
}
