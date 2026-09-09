"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  unsubscribe,
  type UnsubscribeState,
} from "@/app/unsubscribe/[token]/actions";
import { FormMessage, SubmitButton } from "@/components/auth/form-parts";

export function UnsubscribeForm({
  token,
  category,
  title,
  description,
}: {
  token: string;
  category: string;
  title: string;
  description: string;
}) {
  const [state, formAction] = useActionState<UnsubscribeState, FormData>(
    unsubscribe,
    null
  );

  if (state?.success) {
    return (
      <>
        <h1 className="font-display text-xl">Unsubscribed</h1>
        <p className="text-sm text-muted-foreground">{state.success}</p>
        <Link href="/profile" className="text-sm font-medium underline">
          Manage all email settings
        </Link>
      </>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <h1 className="font-display text-xl">Turn off {title.toLowerCase()} emails?</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
      <FormMessage error={state?.error} />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="category" value={category} />
      <SubmitButton>Turn off these emails</SubmitButton>
      <p className="text-xs text-muted-foreground">
        Receipts, refunds and invitations are not affected.
      </p>
    </form>
  );
}
