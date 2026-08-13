"use client";

import { useActionState } from "react";
import { Building2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FormMessage, SubmitButton } from "@/components/auth/form-parts";
import { acceptInvite } from "@/app/(app)/org/join/[inviteId]/actions";
import type { OrgActionState } from "@/app/(app)/org/(manage)/members/actions";

/**
 * The acceptable-invite happy path. Dead invites (revoked/expired/mismatch)
 * never render this — the page shows a static explanation instead, so the
 * only errors surfacing here are races since page load.
 */
export function InviteAcceptCard({
  inviteId,
  orgName,
  role,
}: {
  inviteId: string;
  orgName: string;
  role: "admin" | "member";
}) {
  const [state, action] = useActionState<OrgActionState, FormData>(
    acceptInvite,
    null
  );

  return (
    <Card>
      <CardHeader>
        <span className="mb-2 flex size-11 items-center justify-center rounded-xl bg-secondary text-primary">
          <Building2 className="size-5" aria-hidden="true" />
        </span>
        <CardTitle className="font-display text-2xl">
          Join {orgName}
        </CardTitle>
        <CardDescription>
          {role === "admin"
            ? `You've been invited to ${orgName} as an organisation admin.`
            : `You've been invited to study with ${orgName}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Joining gives you the full question bank while your
          organisation&apos;s plan is active. Your organisation sees your
          aggregate performance —
          accuracy, activity and mock scores — never your individual answers,
          notes or bookmarks.
        </p>
        <FormMessage error={state?.error} success={state?.success} />
      </CardContent>
      <CardFooter>
        <form action={action} className="w-full">
          <input type="hidden" name="inviteId" value={inviteId} />
          <SubmitButton>Accept invite</SubmitButton>
        </form>
      </CardFooter>
    </Card>
  );
}
