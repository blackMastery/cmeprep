import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getQuestionForEdit } from "@/lib/admin/questions";
import { listTopicOptions } from "@/lib/admin/taxonomy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuestionEditor } from "@/components/admin/question-editor";

export const metadata: Metadata = { title: "Edit question" };

export default async function EditQuestionPage(
  props: PageProps<"/admin/questions/[id]">
) {
  const { id } = await props.params;

  const [record, topics] = await Promise.all([
    getQuestionForEdit(id),
    listTopicOptions(),
  ]);

  if (!record) notFound();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/questions">
            <ArrowLeft data-icon="inline-start" />
            Questions
          </Link>
        </Button>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Edit question
        </h1>
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
        topics={topics}
        question={record.question}
        options={record.visibleOptions}
        usageCount={record.usageCount}
      />
    </div>
  );
}
