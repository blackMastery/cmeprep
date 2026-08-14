"use client";

import { useActionState } from "react";
import { createOrg } from "@/app/(app)/org/new/actions";
import type { OrgActionState } from "@/app/(app)/org/(manage)/members/actions";
import { AdminField } from "@/components/admin/form-parts";
import { FormMessage, SubmitButton } from "@/components/auth/form-parts";

export function CreateOrgForm() {
  const [state, action] = useActionState<OrgActionState, FormData>(
    createOrg,
    null
  );

  return (
    <form action={action} className="space-y-4">
      <AdminField
        label="Organisation name"
        name="name"
        placeholder="St. Mary's Hospital"
        required
        maxLength={120}
      />
      <FormMessage error={state?.error} success={state?.success} />
      <SubmitButton>Create organisation</SubmitButton>
    </form>
  );
}
