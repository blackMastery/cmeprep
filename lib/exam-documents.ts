import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { ExamDocument } from "@/lib/supabase/types";

/**
 * Reads for exam_documents.
 *
 * All of them go through the service-role client because the table is
 * deny-all to client roles (see the migration): the entitlement that decides
 * who may read a document is the PAID rule in entitlements-core, which RLS
 * cannot express. Every function here is therefore only as safe as its
 * caller's gate — each one names the gate it expects.
 */

/** The columns any list view needs; `file_path` stays out of client props. */
const LIST_COLUMNS =
  "id, exam_id, title, description, file_name, file_size, content_type, position, is_published, created_at";

export type ExamDocumentSummary = Pick<
  ExamDocument,
  | "id"
  | "exam_id"
  | "title"
  | "description"
  | "file_name"
  | "file_size"
  | "content_type"
  | "position"
  | "is_published"
  | "created_at"
>;

/**
 * Every live document on an exam, drafts included — for the admin card.
 * Gate: requireAdmin() in the page that calls this.
 */
export async function listExamDocumentsForAdmin(
  examId: string
): Promise<ExamDocumentSummary[]> {
  const { data } = await createAdminClient()
    .from("exam_documents")
    .select(LIST_COLUMNS)
    .eq("exam_id", examId)
    .is("deleted_at", null)
    .order("position")
    .order("created_at", { ascending: false });
  return (data ?? []) as ExamDocumentSummary[];
}

/**
 * Published documents for exams the caller has ALREADY been cleared for.
 * Gate: canAccessExam(examDocumentAccessFor(...)) per exam, by the caller —
 * this function trusts the ids it is handed.
 */
export async function listPublishedExamDocuments(
  examIds: readonly string[]
): Promise<ExamDocumentSummary[]> {
  if (examIds.length === 0) return [];
  const { data } = await createAdminClient()
    .from("exam_documents")
    .select(LIST_COLUMNS)
    .in("exam_id", examIds)
    .eq("is_published", true)
    .is("deleted_at", null)
    .order("position")
    .order("created_at", { ascending: false });
  return (data ?? []) as ExamDocumentSummary[];
}

/**
 * How many published documents each exam has, without any of their content.
 * This is what a LOCKED exam may show: a count is an honest upsell, whereas
 * titles are part of what was paid for.
 */
export async function countPublishedExamDocuments(
  examIds: readonly string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (examIds.length === 0) return counts;

  const { data } = await createAdminClient()
    .from("exam_documents")
    .select("exam_id")
    .in("exam_id", examIds)
    .eq("is_published", true)
    .is("deleted_at", null);

  for (const row of data ?? []) {
    counts.set(row.exam_id, (counts.get(row.exam_id) ?? 0) + 1);
  }
  return counts;
}

export type DownloadableDocument = {
  id: string;
  examId: string;
  /** The owning exam's private-bank org, or null for the public catalog. */
  examOrgId: string | null;
  filePath: string;
  fileName: string;
  /** Reported, not filtered on — see the note on the function below. */
  isPublished: boolean;
};

/**
 * One document, resolved for the download route, with the owning exam's
 * org_id alongside it.
 *
 * The org_id is fetched here rather than assumed because this read runs on
 * the admin client, which bypasses the RLS that would otherwise enforce the
 * private-bank wall — the caller has to re-check it with orgExamAllowed /
 * canAccessExam. Same reasoning as the exam lookup in app/api/tests/route.ts.
 *
 * Returns null for a missing or soft-deleted document. `is_published` is
 * REPORTED rather than filtered here: an admin staging a document has to be
 * able to open it and check the right file went up, and forcing them to
 * publish it to paying students first in order to look at it is the opposite
 * of QA. The route applies the flag — to everyone except admins.
 */
export async function getExamDocumentForDownload(
  docId: string
): Promise<DownloadableDocument | null> {
  const admin = createAdminClient();

  const { data: doc } = await admin
    .from("exam_documents")
    .select("id, exam_id, file_path, file_name, is_published")
    .eq("id", docId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!doc) return null;

  // A separate read rather than a PostgREST embed: this feeds a security
  // decision, and a plain select is one less piece of query behaviour to be
  // right about on the path that hands out the bytes.
  const { data: exam } = await admin
    .from("exams")
    .select("org_id")
    .eq("id", doc.exam_id)
    .maybeSingle();
  if (!exam) return null;

  return {
    id: doc.id,
    examId: doc.exam_id,
    examOrgId: exam.org_id,
    filePath: doc.file_path,
    fileName: doc.file_name,
    isPublished: doc.is_published,
  };
}
