import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileText, Lock } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listExamCatalog } from "@/lib/catalog";
import { listActivePlans, upsellPlan } from "@/lib/plans";
import { getExamDocumentAccess } from "@/lib/entitlements";
import { canAccessExam, visibleExamsFor } from "@/lib/entitlements-core";
import {
  countPublishedExamDocuments,
  listPublishedExamDocuments,
  type ExamDocumentSummary,
} from "@/lib/exam-documents";
import { documentKindLabel, formatFileSize } from "@/lib/exam-documents-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Resources" };

/**
 * Syllabus and reference material, per exam.
 *
 * Access is the PAID rule (examDocumentAccessFor), not the practice rule: a
 * trial allowance lets you sit questions, it does not buy the client's
 * syllabus. Locked exams still list — with a document COUNT but no titles —
 * because a count is an honest upsell whereas titles are part of what was
 * paid for. The links below are a convenience only; the actual gate is in
 * app/api/exams/documents/[docId].
 */
export default async function ResourcesPage() {
  const user = await requireUser();

  const [catalog, access, plans] = await Promise.all([
    listExamCatalog(),
    getExamDocumentAccess(user),
    listActivePlans(),
  ]);

  // visibleExamsFor keys public visibility off is_active, so active exams
  // still list for someone with no entitlement at all — which is what makes
  // the upsell possible. It also applies the org private-bank wall.
  const exams = visibleExamsFor(catalog, access);
  const unlockedIds = new Set(
    exams
      .filter((exam) => canAccessExam(access, { id: exam.id, orgId: exam.orgId }))
      .map((exam) => exam.id)
  );

  const [documents, lockedCounts] = await Promise.all([
    listPublishedExamDocuments([...unlockedIds]),
    countPublishedExamDocuments(
      exams.filter((exam) => !unlockedIds.has(exam.id)).map((exam) => exam.id)
    ),
  ]);

  const byExam = new Map<string, ExamDocumentSummary[]>();
  for (const doc of documents) {
    byExam.set(doc.exam_id, [...(byExam.get(doc.exam_id) ?? []), doc]);
  }

  // An exam with nothing published is noise on this page, locked or not.
  const rows = exams
    .map((exam) => ({
      exam,
      unlocked: unlockedIds.has(exam.id),
      documents: byExam.get(exam.id) ?? [],
      count: unlockedIds.has(exam.id)
        ? (byExam.get(exam.id) ?? []).length
        : (lockedCounts.get(exam.id) ?? 0),
    }))
    .filter((row) => row.count > 0);

  const planId = upsellPlan(plans)?.id ?? null;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Resources
        </h1>
        <p className="mt-1 text-muted-foreground">
          Syllabus documents and reference material for the examinations you
          have access to.
        </p>
      </header>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <FileText
              className="mx-auto size-6 text-muted-foreground"
              aria-hidden
            />
            <p className="mt-3 text-sm text-muted-foreground">
              No documents have been published yet. They&apos;ll appear here as
              soon as they are.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {rows.map((row) =>
            row.unlocked ? (
              <UnlockedExamCard
                key={row.exam.id}
                name={row.exam.name}
                code={row.exam.code}
                documents={row.documents}
              />
            ) : (
              <LockedExamCard
                key={row.exam.id}
                name={row.exam.name}
                code={row.exam.code}
                count={row.count}
                href={planId ? `/checkout/${planId}?exam=${row.exam.id}` : null}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

function ExamHeading({ name, code }: { name: string; code: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="font-display text-lg">{name}</h2>
      {code && (
        <Badge variant="outline" className="font-mono">
          {code}
        </Badge>
      )}
    </div>
  );
}

function UnlockedExamCard({
  name,
  code,
  documents,
}: {
  name: string;
  code: string | null;
  documents: ExamDocumentSummary[];
}) {
  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <ExamHeading name={name} code={code} />

        <ul className="space-y-2">
          {documents.map((doc) => (
            <li key={doc.id}>
              <a
                href={`/api/exams/documents/${doc.id}`}
                // Plain anchor, not next/link — the precedent set by the
                // certificate download. This href is a route handler that
                // 302s to a signed URL; router interception would fetch it as
                // an RSC payload first, following the redirect and pulling the
                // file once just to discard it, then mint a second URL for the
                // real navigation.
                className="flex items-center gap-3 rounded-xl border border-border px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <FileText
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium wrap-break-word">
                    {doc.title}
                  </span>
                  {doc.description && (
                    <span className="block text-xs text-muted-foreground">
                      {doc.description}
                    </span>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {documentKindLabel(doc.content_type)} ·{" "}
                    {formatFileSize(doc.file_size)}
                  </span>
                </span>
                <Download
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function LockedExamCard({
  name,
  code,
  count,
  href,
}: {
  name: string;
  code: string | null;
  count: number;
  href: string | null;
}) {
  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <ExamHeading name={name} code={code} />
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5 shrink-0" aria-hidden />
            {count} document{count === 1 ? "" : "s"} — included with a
            subscription to this examination.
          </p>
        </div>
        {href && (
          <Button asChild>
            <Link href={href}>Get access</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
