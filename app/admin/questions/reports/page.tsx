import type { Metadata } from "next";
import { QuestionReportsPage } from "@/components/admin/question-reports-page";

export const metadata: Metadata = { title: "Question reports" };

/** Platform scope: every bank. Nothing here is automatic — a report never
 * changes what students see (question-reports-spec.md §3). */
export default async function AdminQuestionReportsPage(
  props: PageProps<"/admin/questions/reports">
) {
  const sp = await props.searchParams;
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <QuestionReportsPage
        scope={{ kind: "platform" }}
        view={sp.view === "resolved" ? "resolved" : "open"}
        basePath="/admin/questions/reports"
        editorBasePath="/admin/questions"
        backHref="/admin/questions"
        heading="h1"
        ownerCopy=""
      />
    </div>
  );
}
