"use client";

import { useActionState } from "react";
import { register, type AuthState } from "@/app/(auth)/actions";
import { Field, FormMessage, SubmitButton } from "@/components/auth/form-parts";

export function RegisterForm() {
  const [state, formAction] = useActionState<AuthState, FormData>(
    register,
    null
  );

  return (
    <form action={formAction} className="space-y-5">
      <FormMessage error={state?.error} />
      <Field
        label="Full name"
        name="fullName"
        autoComplete="name"
        placeholder="Dr. Anita Persaud"
      />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint="At least 8 characters."
      />
      <SubmitButton>Create account</SubmitButton>
      <p className="text-center text-xs text-muted-foreground">
        We&apos;ll email you a link to verify your address.
      </p>
    </form>
  );
}
