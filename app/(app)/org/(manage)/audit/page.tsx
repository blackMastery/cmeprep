import type { Metadata } from "next";
import { requireOrgAdmin } from "@/lib/orgs";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AuditLog } from "@/lib/supabase/types";
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

export const metadata: Metadata = { title: "Organisation audit log" };

const PAGE = 100;

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Compact meta summary — enough to answer "what changed", not a dump. */
function metaSummary(meta: Record<string, unknown> | null): string {
  if (!meta) return "";
  const text = JSON.stringify(meta);
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

/**
 * Read-only, org-scoped audit trail (SPEC §10). audit_logs stays
 * service-role only; this page IS the guarded read path — no client RLS.
 * Admin ACTIONS only in v1; member content-access logging is a documented
 * gap until the SSO/compliance work.
 */
export default async function OrgAuditPage() {
  const session = await requireOrgAdmin();
  const admin = createAdminClient();

  const { data: rows } = await admin
    .from("audit_logs")
    .select("*")
    .eq("org_id", session.org.id)
    .order("id", { ascending: false })
    .limit(PAGE);
  const logs = (rows ?? []) as AuditLog[];

  const actorIds = [
    ...new Set(logs.map((l) => l.actor_id).filter((id): id is string => !!id)),
  ];
  const actorName = new Map<string, string>();
  if (actorIds.length > 0) {
    const [{ data: profiles }, { data: emails }] = await Promise.all([
      admin.from("profiles").select("id, full_name").in("id", actorIds),
      admin.from("user_emails").select("id, email").in("id", actorIds),
    ]);
    for (const p of profiles ?? []) {
      if (p.full_name) actorName.set(p.id, p.full_name);
    }
    for (const e of emails ?? []) {
      if (!actorName.has(e.id) && e.email) actorName.set(e.id, e.email);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>
          Administrative actions in your organisation — invites, membership
          changes, content edits, assignments, billing. Latest {PAGE} entries.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {when(log.created_at)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {log.actor_id
                      ? (actorName.get(log.actor_id) ?? "Unknown")
                      : "System"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {log.action}
                  </TableCell>
                  <TableCell className="max-w-md truncate font-mono text-xs text-muted-foreground">
                    {metaSummary(log.meta)}
                  </TableCell>
                </TableRow>
              ))}
              {logs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    Nothing logged yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
