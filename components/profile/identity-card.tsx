"use client";

import { useActionState } from "react";
import {
  updateProfileName,
  type ProfileState,
} from "@/app/(app)/profile/actions";
import type { Profile } from "@/lib/supabase/types";
import { ROLE_LABEL } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FormMessage, SubmitButton } from "@/components/auth/form-parts";

const MEMBER_SINCE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function IdentityCard({
  profile,
  email,
}: {
  profile: Profile;
  email: string;
}) {
  const [state, formAction] = useActionState<ProfileState, FormData>(
    updateProfileName,
    null
  );

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-5">
        <h2 className="font-display text-lg">Your details</h2>

        <dl className="space-y-2.5 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="min-w-0 break-all text-right">{email}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Account type</dt>
            <dd>
              <Badge variant={profile.role === "trial" ? "secondary" : "default"}>
                {ROLE_LABEL[profile.role]}
              </Badge>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Member since</dt>
            <dd className="tabular-nums">
              {MEMBER_SINCE.format(new Date(profile.created_at))}
            </dd>
          </div>
        </dl>

        <form action={formAction} className="space-y-4 border-t border-border pt-5">
          <FormMessage error={state?.error} success={state?.success} />
          <Field
            label="Full name"
            name="fullName"
            autoComplete="name"
            defaultValue={profile.full_name ?? ""}
            placeholder="Dr. Jane Doe"
            hint="Shown in your dashboard greeting."
          />
          <SubmitButton>Save name</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
