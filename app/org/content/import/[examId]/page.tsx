import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOrgAdmin } from "@/lib/orgs";
import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/button";
import { ImportWizard } from "@/components/admin/import-wizard";

export const metadata: Metadata = { title: "Import questions" };

export default async function OrgImportPage(
  props: PageProps<"/org/content/import/[examId]">
) {
  const session = await requireOrgAdmin();
  const { examId } = await props.params;

  // Pin the exam to the org up front; the preview/commit routes re-check.
  const admin = createAdminClient();
  const { data: exam } = await admin
    .from("exams")
    .select("id, name, org_id")
    .eq("id", examId)
    .eq("org_id", session.org.id)
    .maybeSingle();
  if (!exam) notFound();

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/org/content">
            <ArrowLeft data-icon="inline-start" />
            Content
          </Link>
        </Button>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          Import into {exam.name}
        </h2>
      </div>

      <ImportWizard
        examId={exam.id}
        examName={exam.name}
        questionsHref="/org/content/questions?published=false"
      />
    </div>
  );
}
