import Link from "next/link";
import { ClipboardList } from "lucide-react";
import type { MemberAssignment } from "@/lib/orgs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/**
 * Dashboard summary of what the org has assigned: the next few OPEN items
 * (completed ones live on /assignments). Rendered only for org members.
 */
export function AssignmentsCard({
  assignments,
  orgName,
}: {
  assignments: MemberAssignment[];
  orgName: string;
}) {
  const open = assignments.filter(
    (a) => a.status !== "completed" && a.status !== "completed_late"
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="size-4 text-primary" aria-hidden="true" />
          Assignments from {orgName}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            All caught up — nothing outstanding.
          </p>
        ) : (
          <ul className="space-y-2">
            {open.slice(0, 3).map((row) => (
              <li
                key={row.assignment.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  {row.assignment.title}
                </span>
                {row.status === "overdue" ? (
                  <Badge variant="destructive">Overdue</Badge>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    due {shortDate(row.assignment.due_at)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" size="sm" className="w-full" asChild>
          <Link href="/assignments">
            {open.length > 0 ? `View all (${open.length} open)` : "View assignments"}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
