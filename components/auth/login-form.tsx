"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, type AuthState } from "@/app/(auth)/actions";
import { Field, FormMessage, SubmitButton } from "@/components/auth/form-parts";

export function LoginForm({
  next,
  initialError,
}: {
  next?: string;
  initialError?: string;
}) {
  const [state, formAction] = useActionState<AuthState, FormData>(
    login,
    initialError ? { error: initialError } : null
  );

  return (
    <form action={formAction} className="space-y-5">
      {next && <input type="hidden" name="next" value={next} />}
      <FormMessage error={state?.error} />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
      />
      <div className="space-y-2">
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
        />
        <div className="text-right">
          <Link
            href="/forgot-password"
            className="text-xs text-muted-foreground hover:text-primary"
          >
            Forgot your password?
          </Link>
        </div>
      </div>
      <SubmitButton>Log in</SubmitButton>
    </form>
  );
}
