import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOrgAdmin } from "@/lib/orgs";
import { questionInScope } from "@/lib/admin/content-scope";
import { getQuestionForEdit } from "@/lib/admin/questions";
import { listSubjectOptions } from "@/lib/admin/taxonomy";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuestionEditor } from "@/components/admin/question-editor";

export const metadata: Metadata = { title: "Edit question" };

export default async function OrgEditQuestionPage(
  props: PageProps<"/org/content/questions/[id]">
) {
  const session = await requireOrgAdmin();
  const { id } = await props.params;

  // Another org's question 404s — same answer as "doesn't exist", so the
  // page never confirms foreign ids. The save action re-checks regardless.
  const admin = createAdminClient();
  if (!(await questionInScope(admin, id, { kind: "org", orgId: session.org.id }))) {
    notFound();
  }

  const [record, subjects] = await Promise.all([
    getQuestionForEdit(id),
    listSubjectOptions(session.org.id),
  ]);
  if (!record) notFound();

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/org/content/questions">
            <ArrowLeft data-icon="inline-start" />
            Questions
          </Link>
        </Button>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          Edit question
        </h2>
        {record.question.deleted_at ? (
          <Badge variant="outline">Deleted</Badge>
        ) : record.question.is_published ? (
          <Badge>Published</Badge>
        ) : (
          <Badge variant="secondary">Draft</Badge>
        )}
        {record.usageCount > 0 && (
          <span className="text-xs text-muted-foreground">
            used in {record.usageCount} test
            {record.usageCount === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <QuestionEditor
        subjects={subjects}
        question={record.question}
        options={record.visibleOptions}
        usageCount={record.usageCount}
        basePath="/org/content/questions"
      />
    </div>
  );
}
