"use client";

import { useActionState } from "react";
import { updatePassword, type AuthState } from "@/app/(auth)/actions";
import { Field, FormMessage, SubmitButton } from "@/components/auth/form-parts";

export function ResetPasswordForm() {
  const [state, formAction] = useActionState<AuthState, FormData>(
    updatePassword,
    null
  );

  return (
    <form action={formAction} className="space-y-5">
      <FormMessage error={state?.error} />
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
  );
}
