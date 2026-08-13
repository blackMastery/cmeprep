import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getOrgMembership } from "@/lib/orgs";
import { inviteAcceptBlocker, maskEmail } from "@/lib/orgs-core";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuid } from "@/lib/validation";
import type { OrgInvite } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InviteAcceptCard } from "@/components/org/invite-accept-card";

export const metadata: Metadata = { title: "Organisation invite" };

function DeadInvite({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl">{title}</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
      <CardContent />
      <CardFooter>
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

/**
 * Invite landing page. The (app) layout already requires a session; the
 * strict email binding and one-org rule are re-checked by the accept ACTION —
 * everything rendered here is presentation of the same rules.
 */
export default async function JoinOrgPage({
  params,
}: {
  params: Promise<{ inviteId: string }>;
}) {
  const user = await requireUser();
  const { inviteId } = await params;

  const content = await (async () => {
    if (!uuid().safeParse(inviteId).success) {
      return (
        <DeadInvite
          title="Invite not found"
          body="This invite link is not valid. Check the link, or ask your organisation admin for a new one."
        />
      );
    }

    const admin = createAdminClient();
    const { data } = await admin
      .from("org_invites")
      .select("*")
      .eq("id", inviteId)
      .maybeSingle();
    if (!data) {
      return (
        <DeadInvite
          title="Invite not found"
          body="This invite no longer exists. Ask your organisation admin for a new one."
        />
      );
    }
    const invite = data as OrgInvite;

    const { data: org } = await admin
      .from("orgs")
      .select("id, name")
      .eq("id", invite.org_id)
      .maybeSingle();
    if (!org) {
      return (
        <DeadInvite
          title="Invite not found"
          body="This organisation no longer exists."
        />
      );
    }

    const membership = await getOrgMembership(user.id);
    if (membership && membership.org.id === invite.org_id) {
      return (
        <DeadInvite
          title={`You're already in ${org.name}`}
          body="Nothing to accept — your membership is active."
        />
      );
    }
    if (membership) {
      return (
        <DeadInvite
          title="One organisation per account"
          body={`Your account already belongs to ${membership.org.name}. Contact support if you need to move to ${org.name}.`}
        />
      );
    }

    const blocker = inviteAcceptBlocker(invite, user.email, new Date());
    if (blocker === "revoked" || blocker === "accepted") {
      return (
        <DeadInvite
          title="Invite unavailable"
          body={
            blocker === "revoked"
              ? `This invite to ${org.name} was revoked.`
              : "This invite has already been used."
          }
        />
      );
    }
    if (blocker === "expired") {
      return (
        <DeadInvite
          title="Invite expired"
          body={`This invite to ${org.name} has expired. Ask your organisation admin to renew it.`}
        />
      );
    }
    if (blocker === "email_mismatch") {
      return (
        <DeadInvite
          title="Wrong account for this invite"
          body={`This invite is for ${maskEmail(invite.email)}, but you're signed in as ${user.email}. Sign in with the invited address, or ask your admin to invite this one.`}
        />
      );
    }

    return (
      <InviteAcceptCard
        inviteId={invite.id}
        orgName={org.name}
        role={invite.role}
      />
    );
  })();

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:py-16">{content}</div>
  );
}
