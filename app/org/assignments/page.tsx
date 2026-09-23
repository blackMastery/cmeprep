import type { Metadata } from "next";
import { requireOrgAdmin } from "@/lib/orgs";
import { loadAssignmentRows } from "@/lib/org-assignments-view";
import { AssignmentsManager } from "@/components/org/assignments-manager";
import { FlashToast } from "@/components/flash-toast";

export const metadata: Metadata = { title: "Assignments" };

export default async function OrgAssignmentsPage(
  props: PageProps<"/org/assignments">
) {
  const session = await requireOrgAdmin();
  const sp = await props.searchParams;

  // Only the rows: the form's exam/member/department options belong to the
  // create and edit pages now, and loading them here was work for nobody.
  const rows = await loadAssignmentRows(session);

  return (
    <>
      {/* The create and edit pages redirect here on success; this is where
          the confirmation surfaces. */}
      {sp.created !== undefined && <FlashToast message="Assignment created." />}
      {sp.updated !== undefined && <FlashToast message="Assignment updated." />}
      <AssignmentsManager rows={rows} />
    </>
  );
}
