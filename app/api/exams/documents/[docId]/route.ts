import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { examDocumentAccessFrom } from "@/lib/entitlements";
import { canAccessExam } from "@/lib/entitlements-core";
import { getExamDocumentForDownload } from "@/lib/exam-documents";
import { EXAM_DOCUMENT_BUCKET } from "@/lib/storage";
import { uuid } from "@/lib/validation";

/**
 * How long a minted link stays good. Short, because a copied link should be
 * worth little — but not 60s: a paused-and-resumed download, or a Range retry
 * on a 50 MB PDF, re-presents the same token and would 400 on an expired one.
 * lib/courses.ts uses 15 minutes for the equivalent private file.
 */
const SIGNED_URL_TTL_SEC = 5 * 60;

/**
 * GET /api/exams/documents/[docId] — download one exam document.
 *
 * SECURITY BOUNDARY. This is the only way the bytes in the private
 * exam-documents bucket reach a student, and the paid entitlement is checked
 * HERE rather than at page render: a document id is not a capability, and
 * /resources deciding not to draw a link is a UI choice, not a control.
 *
 * The signed URL is minted per request instead of embedded in the page so the
 * TTL starts when the student clicks, not when the page was rendered, and so
 * a URL that grants the file never sits in the HTML.
 *
 * getCurrentUser() rather than requireUser(): a redirect to /login is not a
 * useful answer to a fetch for a file.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/exams/documents/[docId]">
) {
  const { docId } = await ctx.params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // requireUser() bounces a banned account to /banned; a route handler has to
  // state it itself.
  if (user.profile.banned_at) {
    return NextResponse.json({ error: "Account suspended" }, { status: 403 });
  }

  const id = uuid().safeParse(docId);
  if (!id.success) {
    return NextResponse.json({ error: "Invalid document" }, { status: 400 });
  }

  // Missing and soft-deleted collapse to 404 — which it was is not the
  // caller's business.
  const document = await getExamDocumentForDownload(id.data);
  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // An unpublished document does not exist as far as students are concerned,
  // and 404 (not 403) keeps it that way. Admins are the exception on purpose:
  // staging a document is worthless if you cannot open it to check the right
  // file went up, and publishing it to paying students in order to look at it
  // is the opposite of QA.
  if (!document.isPublished && user.profile.role !== "admin") {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const admin = createAdminClient();

  // examDocumentAccessFrom, NOT examAccessFrom: trial breadth is a practice
  // allowance and does not buy the syllabus. canAccessExam then applies the
  // org private-bank wall using the exam's own org_id, which the lookup above
  // reads explicitly because this client bypasses the RLS that would
  // otherwise enforce that wall.
  const access = await examDocumentAccessFrom(
    admin,
    user.id,
    user.profile.role
  );
  if (
    !canAccessExam(access, {
      id: document.examId,
      orgId: document.examOrgId,
    })
  ) {
    return NextResponse.json(
      {
        error: "exam_locked",
        message: "Your subscription doesn't include that examination.",
      },
      { status: 403 }
    );
  }

  const { data, error } = await admin.storage
    .from(EXAM_DOCUMENT_BUCKET)
    // `download` names the saved file, so the student gets the original
    // filename rather than the uuid the object is stored under.
    .createSignedUrl(document.filePath, SIGNED_URL_TTL_SEC, {
      download: document.fileName,
    });

  if (error || !data) {
    return NextResponse.json(
      { error: "Could not open that document." },
      { status: 502 }
    );
  }

  // 302, not 307: this is a plain GET, there is no body to preserve, and the
  // target is a different, single-use resource each time.
  return NextResponse.redirect(data.signedUrl, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
