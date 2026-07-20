"use client";

import { useActionState } from "react";
import { updatePassword, type AuthState } from "@/app/(auth)/actions";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FormMessage, SubmitButton } from "@/components/auth/form-parts";

/**
 * Same action as the email-reset flow; the hidden `stay` field makes it
 * return here with an inline notice instead of redirecting to /dashboard.
 */
export function ChangePasswordForm() {
  const [state, formAction] = useActionState<AuthState, FormData>(
    updatePassword,
    null
  );

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <div>
          <h2 className="font-display text-lg">Security</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a new password for your account.
          </p>
        </div>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="stay" value="1" />
          <FormMessage error={state?.error} success={state?.success} />
          <Field
            label="New password"
            name="password"
            type="password"
            autoComplete="new-password"
            hint="At least 8 characters."
          />
          <Field
            label="Confirm new password"
            name="confirm"
            type="password"
            autoComplete="new-password"
          />
          <SubmitButton>Update password</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
