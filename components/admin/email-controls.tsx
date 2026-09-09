"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { AdminState } from "@/app/admin/subjects/actions";
import { runEmailJob, sendTestEmail } from "@/app/admin/emails/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormMessage } from "@/components/auth/form-parts";
import { AdminSelect, AdminSubmit } from "@/components/admin/form-parts";

/** Run either cron job by hand; the result line is the job's summary. */
export function EmailRunControls() {
  const [state, formAction] = useActionState<AdminState, FormData>(runEmailJob, null);
  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <div>
          <h2 className="font-display text-lg">Run a job now</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The same code the schedule calls. Delivery sends whatever is
            still due (failed sends backing off, scan rows); the scan queues
            today&apos;s reminders, digests and alerts.
          </p>
        </div>
        <FormMessage error={state?.error} success={state?.success} />
        <form action={formAction} className="flex flex-wrap gap-2">
          <AdminSubmit name="job" value="deliver" variant="outline-muted">
            Run delivery
          </AdminSubmit>
          <AdminSubmit name="job" value="scan" variant="outline-muted">
            Run daily scan
          </AdminSubmit>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Pick a template, preview it (a plain link — the page renders the sample
 * server-side) or queue its sample to yourself.
 */
export function EmailTestPanel({
  templates,
  selected,
}: {
  templates: readonly { key: string; label: string; transactional: boolean }[];
  selected: string | null;
}) {
  const [template, setTemplate] = useState(selected ?? templates[0]?.key ?? "");
  const [state, formAction] = useActionState<AdminState, FormData>(sendTestEmail, null);

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <div>
          <h2 className="font-display text-lg">Test a template</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every template renders from a fixed sample payload. Preview it
            here, or send it to your own address.
          </p>
        </div>
        <FormMessage error={state?.error} success={state?.success} />
        <form action={formAction} className="space-y-3">
          <AdminSelect
            label="Template"
            name="template"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          >
            {templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
                {t.transactional ? " (transactional)" : ""}
              </option>
            ))}
          </AdminSelect>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline-muted" asChild>
              <Link href={`/admin/emails?preview=${template}`}>Preview</Link>
            </Button>
            <AdminSubmit>Send me a test</AdminSubmit>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
