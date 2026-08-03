"use client";

import { useActionState } from "react";
import {
  submitContact,
  type ContactState,
} from "@/app/(marketing)/about/actions";
import { CONTACT_SUBJECTS } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormMessage, SubmitButton } from "@/components/auth/form-parts";

export function ContactForm({ defaultEmail }: { defaultEmail?: string }) {
  const [state, formAction] = useActionState<ContactState, FormData>(
    submitContact,
    null
  );

  // On success the form is done: React has already cleared the inputs, and
  // leaving an empty form under a thank-you reads like it failed to send.
  if (state?.success) {
    return <FormMessage success={state.success} />;
  }

  const values = state?.values;
  const errors = state?.fieldErrors;

  return (
    <form action={formAction} className="space-y-5">
      <FormMessage error={state?.error} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Your name"
          name="name"
          autoComplete="name"
          defaultValue={values?.name}
          error={errors?.name}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={values?.email ?? defaultEmail}
          error={errors?.email}
          hint="Where we'll reply."
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="subject">Subject</Label>
        {/* Native <select> — it participates in FormData for free, where the
            Radix version needs a shadow hidden input. */}
        <select
          id="subject"
          name="subject"
          required
          defaultValue={values?.subject ?? CONTACT_SUBJECTS[0]}
          aria-invalid={errors?.subject ? true : undefined}
          className="h-11 w-full rounded-lg border border-input bg-background px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm aria-invalid:border-destructive"
        >
          {CONTACT_SUBJECTS.map((subject) => (
            <option key={subject} value={subject}>
              {subject}
            </option>
          ))}
        </select>
        {errors?.subject && (
          <p className="text-xs text-destructive">{errors.subject}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="body">Message</Label>
        <Textarea
          id="body"
          name="body"
          required
          rows={6}
          maxLength={4000}
          defaultValue={values?.body}
          aria-invalid={errors?.body ? true : undefined}
          aria-describedby="body-hint"
          placeholder="Tell us what you need. The more detail, the faster we can help."
        />
        <p
          id="body-hint"
          className={cn(
            "text-xs",
            errors?.body ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {errors?.body ?? "Up to 4000 characters."}
        </p>
      </div>

      {/* Honeypot: off-screen and untabbable, so only a bot fills it in.
          `autoComplete="off"` keeps a password manager from doing it by
          accident and getting a real person silently swallowed. */}
      <div aria-hidden="true" className="absolute left-[-9999px]">
        <label htmlFor="website">Website</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <SubmitButton>Send message</SubmitButton>
    </form>
  );
}
