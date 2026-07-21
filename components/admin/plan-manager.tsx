"use client";

import { useActionState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import {
  createPlan,
  deletePlan,
  reorderPlans,
  updatePlan,
} from "@/app/admin/plans/actions";
import type { AdminState } from "@/app/admin/subjects/actions";
import type { Plan } from "@/lib/supabase/types";
import { priceLabel } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormMessage } from "@/components/auth/form-parts";
import {
  AdminField,
  AdminSubmit,
  AdminTextarea,
} from "@/components/admin/form-parts";
import { ConfirmSubmit } from "@/components/confirm-dialog";

export function PlanManager({ plans }: { plans: Plan[] }) {
  const [createState, createAction] = useActionState<AdminState, FormData>(
    createPlan,
    null
  );

  return (
    <div className="space-y-6">
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="space-y-4">
          <h2 className="font-display text-lg">Add a plan</h2>
          <FormMessage error={createState?.error} success={createState?.success} />
          <form action={createAction} className="space-y-4">
            <PlanFields />
            <AdminSubmit>
              <Plus data-icon="inline-start" />
              Add plan
            </AdminSubmit>
          </form>
        </CardContent>
      </Card>

      {plans.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No plans yet. Add one above — it appears on the marketing pricing
            section straight away.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-4">
          {plans.map((plan, index) => (
            <li key={plan.id}>
              <PlanCard
                plan={plan}
                isFirst={index === 0}
                isLast={index === plans.length - 1}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Shared field set for create and edit — one source, no drift. */
function PlanFields({ plan }: { plan?: Plan }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          label="Name"
          name="name"
          required
          defaultValue={plan?.name ?? ""}
          placeholder="e.g. 6 months"
        />
        <AdminField
          label="Price (USD)"
          name="priceDollars"
          type="number"
          min={0}
          max={10000}
          step="0.01"
          required
          defaultValue={plan ? String(plan.price_cents / 100) : ""}
          hint="0 makes it a free tier."
        />
        <AdminField
          label="Billing period line"
          name="period"
          required
          defaultValue={plan?.period ?? ""}
          placeholder="e.g. six months access"
        />
        <AdminField
          label="Access duration (months)"
          name="durationMonths"
          type="number"
          min={1}
          max={36}
          defaultValue={
            plan?.duration_months != null ? String(plan.duration_months) : ""
          }
          hint="Pre-fills the end date when granting. Leave empty to skip."
        />
      </div>
      <AdminField
        label="Description"
        name="description"
        defaultValue={plan?.description ?? ""}
        placeholder="One line shown on the upgrade card."
      />
      <AdminTextarea
        label="Features"
        name="features"
        rows={4}
        defaultValue={plan?.features.join("\n") ?? ""}
        hint="One per line, up to eight."
      />
      <div className="flex flex-wrap items-center gap-5">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="featured"
            defaultChecked={plan?.featured ?? false}
            className="size-4 accent-[var(--primary)]"
          />
          Featured (&ldquo;Best value&rdquo; — only one plan at a time)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={plan?.is_active ?? true}
            className="size-4 accent-[var(--primary)]"
          />
          Active (visible to students)
        </label>
      </div>
    </>
  );
}

function PlanCard({
  plan,
  isFirst,
  isLast,
}: {
  plan: Plan;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [updateState, updateAction] = useActionState<AdminState, FormData>(
    updatePlan,
    null
  );
  const [deleteState, deleteAction] = useActionState<AdminState, FormData>(
    deletePlan,
    null
  );

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-lg">{plan.name}</span>
          <Badge variant="secondary">{priceLabel(plan.price_cents)}</Badge>
          {plan.featured && <Badge>Featured</Badge>}
          {!plan.is_active && <Badge variant="outline">Inactive</Badge>}

          <span className="ml-auto flex items-center gap-1">
            <ReorderButtons id={plan.id} isFirst={isFirst} isLast={isLast} />
            <form action={deleteAction}>
              <input type="hidden" name="id" value={plan.id} />
              <ConfirmSubmit
                variant="destructive"
                size="icon-sm"
                triggerLabel={`Delete ${plan.name}`}
                title={`Delete "${plan.name}"?`}
                confirmLabel="Delete plan"
                irreversible
                description="Existing subscriptions keep their plan name as text, so history is safe. If this plan was ever sold, consider unticking Active instead."
              >
                <Trash2 />
              </ConfirmSubmit>
            </form>
          </span>
        </div>

        <FormMessage error={deleteState?.error} />
        <FormMessage error={updateState?.error} success={updateState?.success} />

        <form action={updateAction} className="space-y-4 border-t border-border pt-4">
          <input type="hidden" name="id" value={plan.id} />
          <PlanFields plan={plan} />
          <AdminSubmit variant="outline-muted" size="sm">
            Save plan
          </AdminSubmit>
        </form>
      </CardContent>
    </Card>
  );
}

function ReorderButtons({
  id,
  isFirst,
  isLast,
}: {
  id: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [, action] = useActionState<AdminState, FormData>(reorderPlans, null);

  return (
    <span className="flex items-center">
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="direction" value="up" />
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          disabled={isFirst}
          aria-label="Move up"
        >
          <ChevronUp />
        </Button>
      </form>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="direction" value="down" />
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          disabled={isLast}
          aria-label="Move down"
        >
          <ChevronDown />
        </Button>
      </form>
    </span>
  );
}
