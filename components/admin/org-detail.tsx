"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  adminCancelOrgSubscription,
  adminCreateOrg,
  adminInviteToOrg,
  adminRemoveOrgMember,
  adminSaveOrgSubscription,
  adminSetOrgMemberRole,
  adminSetOrgSuspension,
  adminUpdateOrg,
} from "@/app/admin/orgs/actions";
import type { AdminState } from "@/app/admin/subjects/actions";
import {
  AdminField,
  AdminSelect,
  AdminSubmit,
} from "@/components/admin/form-parts";
import { FormMessage } from "@/components/auth/form-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

/* ── serializable shapes the detail page passes down ──────── */

export type OrgSummary = {
  id: string;
  name: string;
  seatLimit: number;
  suspended: boolean;
};

export type OrgSubItem = {
  id: string;
  plan: string;
  planId: string | null;
  /** null = all-access comp grant. */
  examId: string | null;
  examName: string | null;
  status: string;
  currentPeriodEnd: string;
  paypalOrderId: string | null;
};

export type OrgMemberItem = {
  userId: string;
  name: string | null;
  email: string | null;
  role: "admin" | "member";
  /** Read-only — department CRUD/assignment is org-side only. */
  departmentName: string | null;
};

export type OrgInviteItem = {
  id: string;
  email: string;
  role: "admin" | "member";
  expiresAt: string;
};

export type OrgPlanOption = { id: string; name: string; seatLimit: number | null };

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/* ── create (used on the list page) ───────────────────────── */

export function AdminCreateOrgForm() {
  const [state, action] = useActionState<AdminState, FormData>(
    adminCreateOrg,
    null
  );
  return (
    <form action={action} className="flex items-end gap-2">
      <AdminField label="New organisation" name="name" placeholder="Name" />
      <AdminSubmit>Create</AdminSubmit>
      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
    </form>
  );
}

/* ── settings ─────────────────────────────────────────────── */

export function OrgSettingsCard({ org }: { org: OrgSummary }) {
  const [state, action] = useActionState<AdminState, FormData>(
    adminUpdateOrg,
    null
  );
  const [suspendState, suspendAction] = useActionState<AdminState, FormData>(
    adminSetOrgSuspension,
    null
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Settings
          {org.suspended && <Badge variant="destructive">Suspended</Badge>}
        </CardTitle>
        <CardDescription>
          Seat cap counts members plus pending invites. Suspension cuts the
          whole org&apos;s access immediately, whatever its subscription says.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="orgId" value={org.id} />
          <AdminField
            label="Name"
            name="name"
            defaultValue={org.name}
            className="min-w-56 flex-1"
          />
          <AdminField
            label="Seat cap"
            name="seatLimit"
            type="number"
            min={1}
            defaultValue={org.seatLimit}
            className="w-28"
          />
          <AdminSubmit>Save</AdminSubmit>
        </form>
        <FormMessage error={state?.error} success={state?.success} />

        <form action={suspendAction}>
          <input type="hidden" name="orgId" value={org.id} />
          <input
            type="hidden"
            name="suspend"
            value={org.suspended ? "false" : "true"}
          />
          <Button
            type="submit"
            variant={org.suspended ? "outline" : "destructive"}
            size="sm"
          >
            {org.suspended ? "Lift suspension" : "Suspend organisation"}
          </Button>
        </form>
        <FormMessage error={suspendState?.error} success={suspendState?.success} />
      </CardContent>
    </Card>
  );
}

/* ── subscriptions (Path B fulfilment) ────────────────────── */

export function OrgSubscriptionsCard({
  org,
  subscriptions,
  orgPlans,
  publicExams,
}: {
  org: OrgSummary;
  subscriptions: OrgSubItem[];
  orgPlans: OrgPlanOption[];
  /** Public catalog only — org grants never scope to a private bank. */
  publicExams: { id: string; name: string }[];
}) {
  const [state, action] = useActionState<AdminState, FormData>(
    adminSaveOrgSubscription,
    null
  );
  const [cancelState, cancelAction] = useActionState<AdminState, FormData>(
    adminCancelOrgSubscription,
    null
  );
  // Editing an existing row prefills the grant form and arms its hidden
  // orgSubscriptionId — without it every save would INSERT a new row and a
  // mis-granted period could never be corrected.
  const [editing, setEditing] = useState<OrgSubItem | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subscriptions</CardTitle>
        <CardDescription>
          The invoice/PO path: once money arrives out-of-band, grant the
          period here — one examination per grant, or &quot;All exams&quot;
          for a bespoke comp. The picked date is the last day WITH access;
          the 14-day grace applies after it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {subscriptions.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>Exam</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Period end</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.map((sub) => (
                  <TableRow key={sub.id}>
                    <TableCell className="font-medium">{sub.plan}</TableCell>
                    <TableCell>
                      {sub.examId ? (
                        sub.examName
                      ) : (
                        <Badge variant="outline">All exams</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={sub.status === "active" ? "default" : "secondary"}
                      >
                        {sub.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{shortDate(sub.currentPeriodEnd)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {sub.paypalOrderId ? "PayPal" : "Manual"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(sub)}
                        >
                          Edit
                        </Button>
                        {sub.status === "active" && (
                          <form action={cancelAction} className="inline">
                            <input type="hidden" name="orgId" value={org.id} />
                            <input
                              type="hidden"
                              name="orgSubscriptionId"
                              value={sub.id}
                            />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                            >
                              Cancel
                            </Button>
                          </form>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <FormMessage error={cancelState?.error} success={cancelState?.success} />

        {/* key remounts the form when the target changes, so defaultValues
            re-prime — cheaper and less stateful than controlled inputs. */}
        <form
          key={editing?.id ?? "new"}
          action={action}
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="orgId" value={org.id} />
          <input
            type="hidden"
            name="orgSubscriptionId"
            value={editing?.id ?? ""}
          />
          <AdminSelect
            label="Plan"
            name="planPreset"
            className="w-44"
            defaultValue={
              editing ? (editing.planId ?? "custom") : orgPlans[0]?.id
            }
          >
            {orgPlans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </AdminSelect>
          <AdminField
            label="Custom name"
            name="planCustom"
            placeholder="Bespoke terms"
            className="w-44"
            defaultValue={editing && !editing.planId ? editing.plan : undefined}
          />
          <AdminSelect
            label="Examination"
            name="examId"
            className="w-52"
            defaultValue={editing?.examId ?? ""}
          >
            <option value="">All exams (comp)</option>
            {publicExams.map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.name}
              </option>
            ))}
          </AdminSelect>
          <AdminSelect
            label="Status"
            name="status"
            className="w-32"
            defaultValue={editing?.status ?? "active"}
          >
            <option value="active">active</option>
            <option value="expired">expired</option>
            <option value="cancelled">cancelled</option>
          </AdminSelect>
          <AdminField
            label="Last day with access"
            name="currentPeriodEnd"
            type="date"
            className="w-44"
            defaultValue={editing?.currentPeriodEnd.slice(0, 10)}
          />
          <AdminSubmit>{editing ? "Save changes" : "Grant"}</AdminSubmit>
          {editing && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(null)}
            >
              New grant
            </Button>
          )}
        </form>
        <FormMessage error={state?.error} success={state?.success} />
      </CardContent>
    </Card>
  );
}

/* ── members & invites ────────────────────────────────────── */

export function OrgMembersCard({
  org,
  members,
  invites,
  departmentCount,
}: {
  org: OrgSummary;
  members: OrgMemberItem[];
  invites: OrgInviteItem[];
  departmentCount: number;
}) {
  const showDepartments = departmentCount > 0;
  const [inviteState, inviteAction] = useActionState<AdminState, FormData>(
    adminInviteToOrg,
    null
  );
  const [roleState, roleAction] = useActionState<AdminState, FormData>(
    adminSetOrgMemberRole,
    null
  );
  const [removeState, removeAction] = useActionState<AdminState, FormData>(
    adminRemoveOrgMember,
    null
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>People</CardTitle>
        <CardDescription>
          {members.length} member{members.length === 1 ? "" : "s"},{" "}
          {invites.length} open invite{invites.length === 1 ? "" : "s"}
          {showDepartments &&
            ` · ${departmentCount} department${departmentCount === 1 ? "" : "s"}`}{" "}
          — seat cap {org.seatLimit}. Inviting an org admin here is how a
          sales-led org gets its first one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={inviteAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="orgId" value={org.id} />
          <AdminField
            label="Invite email"
            name="email"
            type="email"
            placeholder="director@hospital.org"
            className="min-w-56 flex-1"
          />
          <AdminSelect label="Role" name="role" defaultValue="admin" className="w-36">
            <option value="admin">Org admin</option>
            <option value="member">Member</option>
          </AdminSelect>
          <AdminSubmit>Invite</AdminSubmit>
        </form>
        <FormMessage error={inviteState?.error} success={inviteState?.success} />

        <FormMessage
          error={roleState?.error ?? removeState?.error}
          success={roleState?.success ?? removeState?.success}
        />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                {showDepartments && <TableHead>Department</TableHead>}
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell>
                    <Link
                      href={`/admin/users/${member.userId}`}
                      className="font-medium hover:underline"
                    >
                      {member.name ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell>{member.email ?? "—"}</TableCell>
                  <TableCell>
                    {member.role === "admin" ? (
                      <Badge>Org admin</Badge>
                    ) : (
                      <Badge variant="secondary">Member</Badge>
                    )}
                  </TableCell>
                  {showDepartments && (
                    <TableCell className="text-muted-foreground">
                      {member.departmentName ?? "—"}
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <form action={roleAction}>
                        <input type="hidden" name="orgId" value={org.id} />
                        <input type="hidden" name="userId" value={member.userId} />
                        <input
                          type="hidden"
                          name="role"
                          value={member.role === "admin" ? "member" : "admin"}
                        />
                        <Button type="submit" variant="ghost" size="sm">
                          {member.role === "admin" ? "Make member" : "Make admin"}
                        </Button>
                      </form>
                      <form
                        action={removeAction}
                        onSubmit={(event) => {
                          if (
                            !window.confirm(
                              `Remove ${member.name ?? member.email ?? "this member"} from ${org.name}?`
                            )
                          ) {
                            event.preventDefault();
                          }
                        }}
                      >
                        <input type="hidden" name="orgId" value={org.id} />
                        <input type="hidden" name="userId" value={member.userId} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                        >
                          Remove
                        </Button>
                      </form>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {invites.map((invite) => (
                <TableRow key={invite.id} className="text-muted-foreground">
                  <TableCell>Invited</TableCell>
                  <TableCell>{invite.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {invite.role === "admin" ? "Org admin" : "Member"} · until{" "}
                      {shortDate(invite.expiresAt)}
                    </Badge>
                  </TableCell>
                  {showDepartments && <TableCell />}
                  <TableCell />
                </TableRow>
              ))}
              {members.length === 0 && invites.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={showDepartments ? 5 : 4}
                    className="text-muted-foreground"
                  >
                    Nobody yet — invite the first org admin above.
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
