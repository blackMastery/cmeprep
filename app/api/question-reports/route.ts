import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  fileQuestionReport,
  withdrawQuestionReport,
} from "@/lib/question-reports";
import {
  questionReportSchema,
  withdrawQuestionReportSchema,
} from "@/lib/validation";

/**
 * The one endpoint all four student entry points post to
 * (question-reports-spec.md §2): mid-test tap, review dialog, tutor reveal
 * dialog, /bookmarks dialog. Every rule lives in lib/question-reports.ts;
 * this file only authenticates and shapes JSON.
 *
 * Reports never change what students see — no threshold unpublishes
 * anything. The verdict stands until a human moves it.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.profile.banned_at) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = questionReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const result = await fileQuestionReport({ userId: user.id, ...parsed.data });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(
    { reported: true, status: result.status },
    { status: result.status === "created" ? 201 : 200 }
  );
}

/** Mid-test undo of a bare tap. Final after submit — then this is a no-op. */
export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.profile.banned_at) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = withdrawQuestionReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { withdrawn } = await withdrawQuestionReport({
    userId: user.id,
    ...parsed.data,
  });
  if (!withdrawn) {
    return NextResponse.json(
      { error: "This report can no longer be withdrawn" },
      { status: 409 }
    );
  }
  return NextResponse.json({ withdrawn: true });
}
