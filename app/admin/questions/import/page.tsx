import { redirect } from "next/navigation";

/** Global import was replaced by per-exam import at /admin/exams/[id]/import. */
export default function ImportQuestionsRedirect() {
  redirect("/admin/exams");
}
