"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import {
  inviteMembers,
  removeMember,
  resendInvite,
  revokeInvite,
  setMemberRole,
  type OrgActionState,
} from "@/app/org/members/actions";
import { setMemberDepartment } from "@/app/org/members/department-actions";
import {
  AdminSelect,
  AdminSubmit,
  AdminTextarea,
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

export type MemberItem = {
  userId: string;
  name: string | null;
  email: string | null;
  role: "admin" | "member";
  joinedAt: string;
  departmentId: string | null;
};

export type InviteItem = {
  id: string;
  email: string;
  role: "admin" | "member";
  expiresAt: string;
  pending: boolean;
  departmentName: string | null;
};

export type DepartmentOption = { id: string; name: string };

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * One inline auto-submitting select per member row (no bulk multi-select in
 * v1). Controlled, with per-row action state: a rejected move snaps the
 * select back to the server value and shows its error beside the row — an
 * uncontrolled select would keep displaying the choice the server refused.
 */
function MemberDepartmentSelect({
  userId,
  departmentId,
  departments,
  memberLabel,
}: {
  userId: string;
  departmentId: string | null;
  departments: DepartmentOption[];
  memberLabel: string;
}) {
  const [state, action] = useActionState<OrgActionState, FormData>(
    setMemberDepartment,
    null
  );
  const serverValue = departmentId ?? "";
  // The optimistic choice, tagged with the action state it was made under.
  // Displayed only while that state is still current: the action completing
  // (success OR error) replaces the state object, which hands display back
  // to the server value — so a rejected move snaps back, and a successful
  // one shows the revalidated value. Derivation only; no effects.
  const [choice, setChoice] = useState<{
    value: string;
    sinceState: OrgActionState;
  } | null>(null);
  const display =
    choice !== null && choice.sinceState === state ? choice.value : serverValue;

  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <select
        name="departmentId"
        value={display}
        aria-label={`Department for ${memberLabel}`}
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        onChange={(event) => {
          setChoice({ value: event.target.value, sinceState: state });
          event.currentTarget.form?.requestSubmit();
        }}
      >
        <option value="">No department</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      {state?.error && (
        <p className="mt-1 text-xs text-destructive">{state.error}</p>
      )}
    </form>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? (
        <Check className="size-3.5" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

export function MembersManager({
  members,
  invites,
  departments,
  currentUserId,
  joinBaseUrl,
}: {
  members: MemberItem[];
  invites: InviteItem[];
  departments: DepartmentOption[];
  currentUserId: string;
  joinBaseUrl: string;
}) {
  const [inviteState, inviteAction] = useActionState<OrgActionState, FormData>(
    inviteMembers,
    null
  );
  const [memberState, roleAction] = useActionState<OrgActionState, FormData>(
    setMemberRole,
    null
  );
  const [removeState, removeAction] = useActionState<OrgActionState, FormData>(
    removeMember,
    null
  );
  const [inviteRowState, revokeAction] = useActionState<
    OrgActionState,
    FormData
  >(revokeInvite, null);
  const [resendState, resendAction] = useActionState<OrgActionState, FormData>(
    resendInvite,
    null
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Invite people</CardTitle>
          <CardDescription>
            Paste email addresses separated by commas, spaces or new lines.
            New addresses get an email; existing accounts see the invite on
            their dashboard. Invites expire after 14 days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={inviteAction} className="space-y-4">
            <AdminTextarea
              label="Email addresses"
              name="emails"
              rows={3}
              placeholder={"jane@hospital.org\namir@hospital.org"}
              required
            />
            <div className="flex flex-wrap items-end gap-4">
              <AdminSelect
                label="Invite as"
                name="role"
                defaultValue="member"
                className="w-44"
              >
                <option value="member">Member</option>
                <option value="admin">Org admin</option>
              </AdminSelect>
              {departments.length > 0 && (
                <AdminSelect
                  label="Department (optional)"
                  name="departmentId"
                  defaultValue=""
                  className="w-52"
                >
                  <option value="">No department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </AdminSelect>
              )}
              <AdminSubmit>Send invites</AdminSubmit>
            </div>
            <FormMessage
              error={inviteState?.error}
              success={inviteState?.success}
            />
          </form>
        </CardContent>
      </Card>

      {invites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invites</CardTitle>
            <CardDescription>
              Pending invites hold a seat; expired ones don&apos;t until
              renewed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <FormMessage
              error={inviteRowState?.error ?? resendState?.error}
              success={inviteRowState?.success ?? resendState?.success}
            />
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    {departments.length > 0 && <TableHead>Department</TableHead>}
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.map((invite) => (
                    <TableRow key={invite.id}>
                      <TableCell className="font-medium">
                        {invite.email}
                      </TableCell>
                      <TableCell>
                        {invite.role === "admin" ? "Org admin" : "Member"}
                      </TableCell>
                      {departments.length > 0 && (
                        <TableCell className="text-muted-foreground">
                          {invite.departmentName ?? "—"}
                        </TableCell>
                      )}
                      <TableCell>
                        {invite.pending ? (
                          <span className="text-muted-foreground">
                            Expires {shortDate(invite.expiresAt)}
                          </span>
                        ) : (
                          <Badge variant="secondary">Expired</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <CopyLinkButton url={`${joinBaseUrl}${invite.id}`} />
                          <form action={resendAction}>
                            <input
                              type="hidden"
                              name="inviteId"
                              value={invite.id}
                            />
                            <Button type="submit" variant="ghost" size="sm">
                              {invite.pending ? "Extend" : "Renew"}
                            </Button>
                          </form>
                          <form action={revokeAction}>
                            <input
                              type="hidden"
                              name="inviteId"
                              value={invite.id}
                            />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                            >
                              Revoke
                            </Button>
                          </form>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            Removing someone frees their seat immediately; their personal
            account and history are untouched.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <FormMessage
            error={memberState?.error ?? removeState?.error}
            success={memberState?.success ?? removeState?.success}
          />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  {departments.length > 0 && <TableHead>Department</TableHead>}
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.userId}>
                    <TableCell className="font-medium">
                      {/* Through to the readiness drill-down (SPEC §8 v2). */}
                      <Link
                        href={`/org/members/${member.userId}`}
                        className="hover:underline"
                      >
                        {member.name ?? "—"}
                      </Link>
                      {member.userId === currentUserId && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          (you)
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{member.email ?? "—"}</TableCell>
                    <TableCell>
                      {member.role === "admin" ? (
                        <Badge>Org admin</Badge>
                      ) : (
                        <Badge variant="secondary">Member</Badge>
                      )}
                    </TableCell>
                    {departments.length > 0 && (
                      <TableCell>
                        <MemberDepartmentSelect
                          userId={member.userId}
                          departmentId={member.departmentId}
                          departments={departments}
                          memberLabel={
                            member.name ?? member.email ?? "member"
                          }
                        />
                      </TableCell>
                    )}
                    <TableCell className="text-muted-foreground">
                      {shortDate(member.joinedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <form action={roleAction}>
                          <input
                            type="hidden"
                            name="userId"
                            value={member.userId}
                          />
                          <input
                            type="hidden"
                            name="role"
                            value={member.role === "admin" ? "member" : "admin"}
                          />
                          <Button type="submit" variant="ghost" size="sm">
                            {member.role === "admin"
                              ? "Make member"
                              : "Make admin"}
                          </Button>
                        </form>
                        <form
                          action={removeAction}
                          onSubmit={(event) => {
                            if (
                              !window.confirm(
                                `Remove ${member.name ?? member.email ?? "this member"} from the organisation?`
                              )
                            ) {
                              event.preventDefault();
                            }
                          }}
                        >
                          <input
                            type="hidden"
                            name="userId"
                            value={member.userId}
                          />
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
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
