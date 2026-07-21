"use client";

import { useActionState, useState } from "react";
import { CreditCard } from "lucide-react";
import {
  cancelSubscription,
  saveSubscription,
} from "@/app/admin/users/actions";
import type { AdminState } from "@/app/admin/subjects/actions";
import type { Subscription } from "@/lib/supabase/types";
import { SUB_STATUSES } from "@/lib/validation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FormMessage } from "@/components/auth/form-parts";
import {
  AdminField,
  AdminSelect,
  AdminSubmit,
} from "@/components/admin/form-parts";
import { ConfirmSubmit } from "@/components/confirm-dialog";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const SUB_BADGE: Record<
  Subscription["status"],
  "default" | "outline" | "destructive"
> = {
  active: "default",
  expired: "outline",
  cancelled: "destructive",
};

function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

function addMonths(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Active paid plans from the plans table (name + default duration). */
export type PlanPreset = { name: string; durationMonths: number | null };

export function UserSubscriptionCard({
  userId,
  subscriptions,
  presets,
}: {
  userId: string;
  subscriptions: Subscription[];
  presets: PlanPreset[];
}) {
  const [saveState, saveAction] = useActionState<AdminState, FormData>(
    saveSubscription,
    null
  );
  const [cancelState, cancelAction] = useActionState<AdminState, FormData>(
    cancelSubscription,
    null
  );

  const latest = subscriptions[0] ?? null;
  const editing = latest !== null && latest.status === "active";

  const isPreset = (name: string) => presets.some((p) => p.name === name);
  const initialPreset = editing
    ? isPreset(latest.plan)
      ? latest.plan
      : "custom"
    : (presets[0]?.name ?? "custom");

  const [preset, setPreset] = useState<string>(initialPreset);
  // Until the admin touches the date, switching preset keeps it in step.
  const [dateDirty, setDateDirty] = useState(editing);
  const [endDate, setEndDate] = useState<string>(
    editing
      ? toDateInput(latest.current_period_end)
      : addMonths(presets[0]?.durationMonths ?? 1)
  );

  const onPresetChange = (value: string) => {
    setPreset(value);
    const months = presets.find((p) => p.name === value)?.durationMonths;
    if (!dateDirty && months) setEndDate(addMonths(months));
  };

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg">Subscription</h2>
          {editing && latest.paypal_subscription_id && (
            <Badge variant="outline">PayPal-managed</Badge>
          )}
        </div>

        {editing && latest.paypal_subscription_id && (
          <p className="text-xs text-muted-foreground">
            Created by PayPal billing — admin edits override webhook state.
          </p>
        )}

        <form action={saveAction} className="space-y-4">
          <input type="hidden" name="userId" value={userId} />
          {editing && (
            <input type="hidden" name="subscriptionId" value={latest.id} />
          )}
          <FormMessage error={saveState?.error} success={saveState?.success} />

          <AdminSelect
            label="Plan"
            name="planPreset"
            value={preset}
            onChange={(e) => onPresetChange(e.target.value)}
            hint={
              presets.length === 0
                ? "No active paid plans — manage them under Admin › Plans."
                : undefined
            }
          >
            {presets.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </AdminSelect>

          {preset === "custom" && (
            <AdminField
              label="Custom plan name"
              name="planCustom"
              required
              defaultValue={editing && !isPreset(latest.plan) ? latest.plan : ""}
              placeholder="e.g. Scholarship 6 months"
            />
          )}

          <AdminSelect
            label="Status"
            name="status"
            defaultValue={editing ? latest.status : "active"}
            hint="Active with a future end date makes the user a Student; anything else drops non-admins back to Trial."
          >
            {SUB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </AdminSelect>

          <AdminField
            label="Access ends"
            name="currentPeriodEnd"
            type="date"
            required
            value={endDate}
            onChange={(e) => {
              setDateDirty(true);
              setEndDate(e.target.value);
            }}
            hint="The chosen date is the last day WITH access."
          />

          <AdminSubmit>
            <CreditCard data-icon="inline-start" />
            {editing ? "Save subscription" : "Grant subscription"}
          </AdminSubmit>
        </form>

        {editing && (
          <form action={cancelAction} className="border-t border-border pt-4">
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="subscriptionId" value={latest.id} />
            <FormMessage error={cancelState?.error} success={cancelState?.success} />
            <ConfirmSubmit
              variant="destructive"
              size="sm"
              title="Cancel this subscription?"
              description="Their role drops back to Trial unless another active plan remains."
              confirmLabel="Cancel subscription"
            >
              Cancel subscription
            </ConfirmSubmit>
          </form>
        )}

        {subscriptions.length > 0 && (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              History
            </p>
            <ul className="space-y-2">
              {subscriptions.map((sub) => (
                <li
                  key={sub.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span className="font-medium">{sub.plan}</span>
                  <Badge variant={SUB_BADGE[sub.status]}>{sub.status}</Badge>
                  {sub.paypal_subscription_id && (
                    <Badge variant="outline">PayPal</Badge>
                  )}
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {dateFormatter.format(new Date(sub.created_at))} →{" "}
                    {dateFormatter.format(new Date(sub.current_period_end))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
