import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireOrgAdmin } from "@/lib/orgs";
import { listSubjectOptions } from "@/lib/admin/taxonomy";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { QuestionEditor } from "@/components/admin/question-editor";

export const metadata: Metadata = { title: "New question" };

export default async function OrgNewQuestionPage() {
  const session = await requireOrgAdmin();
  // Org subjects only: the picker must not offer public taxonomy the save
  // action would (rightly) refuse.
  const subjects = await listSubjectOptions(session.org.id);

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/org/content/questions">
            <ArrowLeft data-icon="inline-start" />
            Questions
          </Link>
        </Button>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          New question
        </h2>
      </div>

      {subjects.length === 0 ? (
        <Card className="[--card-spacing:--spacing(6)]">
          <CardContent className="space-y-3 text-center">
            <h3 className="font-display text-lg">Build your tree first</h3>
            <p className="text-sm text-muted-foreground">
              Every question belongs to a subject — create an exam, a
              specialty and a subject, then come back.
            </p>
            <Button asChild>
              <Link href="/org/content">Manage content</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <QuestionEditor subjects={subjects} basePath="/org/content/questions" />
      )}
    </div>
  );
}
