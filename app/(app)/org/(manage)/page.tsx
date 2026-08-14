import type { Metadata } from "next";
import {
  AlertTriangle,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  getOrgDashboard,
  listAssignmentProgress,
  requireOrgAdmin,
} from "@/lib/orgs";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatCard } from "@/components/dashboard/stat-card";

export const metadata: Metadata = { title: "Organisation dashboard" };

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

const REASON_LABEL = {
  below_pass_mark: "Below pass mark",
  inactive: "Inactive",
} as const;

/**
 * The program-director view (SPEC §8): aggregates and risk flags, never
 * individual answers — that boundary is enforced in lib/orgs.ts, which has
 * no path into review data.
 */
export default async function OrgDashboardPage() {
  const session = await requireOrgAdmin();

  const [dashboard, progress] = await Promise.all([
    getOrgDashboard(session.org),
    listAssignmentProgress(session.org.id),
  ]);
  const { headline } = dashboard;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Users} label="Members" value={headline.members} />
        <StatCard
          icon={TrendingUp}
          label="Average accuracy"
          tone="teal"
          value={
            headline.averageAccuracy !== null
              ? `${headline.averageAccuracy}%`
              : "—"
          }
          hint={`Pass mark ${session.org.pass_mark_pct}%`}
        />
        <StatCard
          icon={Target}
          label="Active this week"
          tone="teal"
          value={headline.activeThisWeek}
        />
        <StatCard
          icon={AlertTriangle}
          label="At risk"
          value={headline.atRisk}
          hint={
            headline.atRisk > 0
              ? "Below pass mark or inactive"
              : "Nobody flagged"
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            Accuracy is the last 30 days when there&apos;s enough recent
            practice, all-time otherwise. You see aggregates — never
            individual answers, notes or bookmarks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Attempted</TableHead>
                  <TableHead>Accuracy</TableHead>
                  <TableHead>Last active</TableHead>
                  <TableHead>Assignments</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.members.map((row) => (
                  <TableRow key={row.member.user_id}>
                    <TableCell>
                      <span className="block font-medium">
                        {row.name ?? "—"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {row.email ?? ""}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.attempted}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.accuracyPct !== null ? `${row.accuracyPct}%` : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.lastActiveDay
                        ? shortDate(`${row.lastActiveDay}T00:00:00Z`)
                        : "Never"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.assignmentsCompleted}
                    </TableCell>
                    <TableCell>
                      {row.risk.atRisk ? (
                        <div className="flex flex-wrap gap-1">
                          {row.risk.reasons.map((reason) => (
                            <Badge key={reason} variant="destructive">
                              {REASON_LABEL[reason]}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <Badge variant="secondary">OK</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {dashboard.members.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      No members yet — invite people from the Members tab.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {progress.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Assignment completion</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {progress.map(({ assignment, targeted, completed, late }) => (
                <li
                  key={assignment.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {assignment.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    due {shortDate(assignment.due_at)}
                  </span>
                  <Badge
                    variant={
                      completed >= targeted && targeted > 0
                        ? "default"
                        : "secondary"
                    }
                  >
                    {completed}/{targeted}
                    {late > 0 ? ` · ${late} late` : ""}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
