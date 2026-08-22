import type { Metadata } from "next";
import { requireOrgAdmin } from "@/lib/orgs";
import { QuestionReportsPage } from "@/components/admin/question-reports-page";

export const metadata: Metadata = { title: "Question reports" };

/** The org's own bank only — the read is pinned to exams with this org_id,
 * so no org ever sees another org's reports or the public bank's. */
export default async function OrgQuestionReportsPage(
  props: PageProps<"/org/content/reports">
) {
  const session = await requireOrgAdmin();
  const sp = await props.searchParams;
  return (
    <QuestionReportsPage
      scope={{ kind: "org", orgId: session.org.id }}
      view={sp.view === "resolved" ? "resolved" : "open"}
      basePath="/org/content/reports"
      editorBasePath="/org/content/questions"
      backHref="/org/content/questions"
      heading="h2"
      ownerCopy="by your members"
    />
  );
}
