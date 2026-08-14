import type { Metadata } from "next";
import Link from "next/link";
import { listOrgsForAdmin } from "@/lib/admin/orgs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminCreateOrgForm } from "@/components/admin/org-detail";

export const metadata: Metadata = { title: "Organisations" };

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const STATE_LABEL = {
  active: "Active",
  grace: "Grace",
  locked: "Inactive",
} as const;

export default async function AdminOrgsPage() {
  const rows = await listOrgsForAdmin();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Organisations
          </h1>
          <p className="mt-1 text-muted-foreground">
            {rows.length} organisation{rows.length === 1 ? "" : "s"}. Creating
            one here is the start of the invoice/PO path — grant the
            subscription from its detail page once money arrives.
          </p>
        </div>
        <AdminCreateOrgForm />
      </header>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Seats</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Access until</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ org, members, pendingInvites, state, currentPeriodEnd }) => (
              <TableRow key={org.id}>
                <TableCell>
                  <Link
                    href={`/admin/orgs/${org.id}`}
                    className="font-medium hover:underline"
                  >
                    {org.name}
                  </Link>
                  {org.suspended_at !== null && (
                    <Badge variant="destructive" className="ml-2">
                      Suspended
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">
                  {members + pendingInvites}/{org.seat_limit}
                </TableCell>
                <TableCell>
                  <Badge variant={state === "active" ? "default" : "secondary"}>
                    {STATE_LABEL[state]}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {currentPeriodEnd ? shortDate(currentPeriodEnd) : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {shortDate(org.created_at)}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  No organisations yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
