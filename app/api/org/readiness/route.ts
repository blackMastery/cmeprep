import {
  getOrgReadinessDashboard,
  listOrgDepartments,
  listOrgEntitledExams,
  requireOrgAdminJson,
} from "@/lib/orgs";
import { readinessCsv } from "@/lib/orgs-core";

/**
 * GET /api/org/readiness?exam=…&department=… — the readiness table as CSV,
 * for program directors who report upward in spreadsheets. Same privacy
 * boundary as the dashboard: aggregates only.
 */
export async function GET(request: Request) {
  const gate = await requireOrgAdminJson();
  if ("response" in gate) return gate.response;
  const { session } = gate;

  const now = new Date();
  const url = new URL(request.url);

  const exams = await listOrgEntitledExams(session.org, now);
  if (exams.length === 0) {
    return Response.json({ error: "No entitled examinations" }, { status: 404 });
  }
  // Unknown params fall back to defaults, mirroring the dashboard page.
  const requestedExam = url.searchParams.get("exam");
  const examId = exams.some((e) => e.id === requestedExam)
    ? requestedExam!
    : exams[0].id;

  const [dashboard, departments] = await Promise.all([
    getOrgReadinessDashboard(session.org, examId, now),
    listOrgDepartments(session.org.id),
  ]);
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));

  const requestedDept = url.searchParams.get("department");
  const rows = dashboard.members.filter((row) =>
    requestedDept === null
      ? true
      : requestedDept === "unassigned"
        ? row.member.department_id === null
        : row.member.department_id === requestedDept
  );

  const csv = readinessCsv(
    rows.map((row) => ({
      name: row.name,
      email: row.email,
      department: row.member.department_id
        ? (departmentName.get(row.member.department_id) ?? null)
        : null,
      readiness: row.readiness,
      lastActiveDay: row.lastActiveDay,
      assignmentsCompleted: row.assignmentsCompleted,
    }))
  );

  const stamp = now.toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="readiness-${stamp}.csv"`,
    },
  });
}
