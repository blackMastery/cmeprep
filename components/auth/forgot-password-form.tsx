"use client";

import { useActionState } from "react";
import { requestPasswordReset, type AuthState } from "@/app/(auth)/actions";
import { Field, FormMessage, SubmitButton } from "@/components/auth/form-parts";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<AuthState, FormData>(
    requestPasswordReset,
    null
  );

  return (
    <form action={formAction} className="space-y-5">
      <FormMessage error={state?.error} success={state?.success} />
      {!state?.success && (
        <>
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
          />
          <SubmitButton>Send reset link</SubmitButton>
        </>
      )}
    </form>
  );
}
