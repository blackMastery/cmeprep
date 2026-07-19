import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listTopicOptions } from "@/lib/admin/taxonomy";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { QuestionEditor } from "@/components/admin/question-editor";

export const metadata: Metadata = { title: "New question" };

export default async function NewQuestionPage() {
  const topics = await listTopicOptions();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/questions">
            <ArrowLeft data-icon="inline-start" />
            Questions
          </Link>
        </Button>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          New question
        </h1>
      </div>

      {topics.length === 0 ? (
        <Card className="[--card-spacing:--spacing(6)]">
          <CardContent className="space-y-3 text-center">
            <h2 className="font-display text-lg">Create a topic first</h2>
            <p className="text-sm text-muted-foreground">
              Every question belongs to a topic.
            </p>
            <Button asChild>
              <Link href="/admin/subjects">Manage subjects &amp; topics</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <QuestionEditor topics={topics} />
      )}
    </div>
  );
}
