import Link from "next/link";
import { ArrowRight, UsersRound } from "lucide-react";
import type { AdminUserRow } from "@/lib/admin/users";
import type { Subscription } from "@/lib/supabase/types";
import { ROLE_LABEL } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const SUB_BADGE: Record<
  Subscription["status"],
  "default" | "outline" | "destructive"
> = {
  active: "default",
  expired: "outline",
  cancelled: "destructive",
};

/** Shared bits so the card and table presentations can never drift. */
function NameBits({ row }: { row: AdminUserRow }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-medium">{row.profile.full_name ?? "—"}</span>
      {row.profile.banned_at && <Badge variant="destructive">Banned</Badge>}
    </span>
  );
}

function RoleBadge({ row }: { row: AdminUserRow }) {
  return (
    <Badge variant={row.profile.role === "trial" ? "secondary" : "default"}>
      {ROLE_LABEL[row.profile.role]}
    </Badge>
  );
}

function PlanBits({ row }: { row: AdminUserRow }) {
  const sub = row.latestSubscription;
  if (!sub) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-sm">{sub.plan}</span>
      <Badge variant={SUB_BADGE[sub.status]}>{sub.status}</Badge>
      <span className="text-xs text-muted-foreground">
        ends {dateFormatter.format(new Date(sub.current_period_end))}
      </span>
    </span>
  );
}

function ViewLink({ row }: { row: AdminUserRow }) {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link href={`/admin/users/${row.profile.id}`}>
        View
        <ArrowRight data-icon="inline-end" />
      </Link>
    </Button>
  );
}

export function UsersTable({ rows }: { rows: AdminUserRow[] }) {
  if (rows.length === 0) {
    return (
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-accent text-primary">
            <UsersRound className="size-6" aria-hidden="true" />
          </span>
          <p className="text-sm text-muted-foreground">
            No users match this search.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Phones: stacked cards */}
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={row.profile.id}>
            <Card className="[--card-spacing:--spacing(4)]">
              <CardContent className="space-y-2.5">
                <NameBits row={row} />
                <p className="text-sm break-all text-muted-foreground">
                  {row.email ?? "—"}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <RoleBadge row={row} />
                  <PlanBits row={row} />
                </div>
                <div className="flex items-center justify-between border-t border-border pt-2">
                  <span className="text-xs text-muted-foreground">
                    Joined {dateFormatter.format(new Date(row.profile.created_at))}
                  </span>
                  <ViewLink row={row} />
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      {/* md and up: table */}
      <Card className="hidden [--card-spacing:--spacing(5)] md:block">
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.profile.id}>
                  <TableCell>
                    <NameBits row={row} />
                  </TableCell>
                  <TableCell className="max-w-56 break-all text-muted-foreground">
                    {row.email ?? "—"}
                  </TableCell>
                  <TableCell>
                    <RoleBadge row={row} />
                  </TableCell>
                  <TableCell>
                    <PlanBits row={row} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {dateFormatter.format(new Date(row.profile.created_at))}
                  </TableCell>
                  <TableCell className="text-right">
                    <ViewLink row={row} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
