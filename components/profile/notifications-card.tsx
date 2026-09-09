"use client";

import { useActionState } from "react";
import {
  updateNotificationPreferences,
  type ProfileState,
} from "@/app/(app)/profile/actions";
import type {
  NotificationCategory,
  NotificationPrefs,
} from "@/lib/email-core";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FormMessage, SubmitButton } from "@/components/auth/form-parts";

/**
 * The optional email categories (notifications-plan.md). Labels arrive as
 * props so the template copy in lib/email-core.ts stays out of the client
 * bundle. Each shown toggle also posts a `shown_<key>` marker: the action
 * writes only those, so a category hidden from this user (the org-admin
 * ones) is left exactly as it was.
 */
export function NotificationsCard({
  prefs,
  categories,
}: {
  prefs: NotificationPrefs;
  categories: { key: NotificationCategory; title: string; description: string }[];
}) {
  const [state, formAction] = useActionState<ProfileState, FormData>(
    updateNotificationPreferences,
    null
  );

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-5">
        <div>
          <h2 className="font-display text-lg">Email notifications</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Receipts, refunds and invitations always arrive. Choose the rest.
          </p>
        </div>

        <form action={formAction} className="space-y-4">
          <FormMessage error={state?.error} success={state?.success} />
          <ul className="space-y-3">
            {categories.map((category) => (
              <li key={category.key} className="flex items-start gap-3">
                <Checkbox
                  id={`pref-${category.key}`}
                  name={category.key}
                  defaultChecked={prefs[category.key]}
                  className="mt-0.5"
                />
                <input type="hidden" name={`shown_${category.key}`} value="1" />
                <div className="space-y-0.5">
                  <Label htmlFor={`pref-${category.key}`}>{category.title}</Label>
                  <p className="text-xs text-muted-foreground">
                    {category.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <SubmitButton>Save email settings</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
