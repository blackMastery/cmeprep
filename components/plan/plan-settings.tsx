"use client";

import { useActionState } from "react";
import {
  setIntensityAction,
  setSittingDateAction,
  type PlanActionState,
} from "@/app/(app)/plan/actions";
import { PLAN_INTENSITY_TARGETS } from "@/lib/plan-core";
import type { PlanIntensity } from "@/lib/supabase/types";
import { FormMessage } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const INTENSITY_LABEL: Record<PlanIntensity, string> = {
  light: "Light",
  standard: "Standard",
  intense: "Intense",
};

/**
 * Intensity + personal exam date. Both apply from the NEXT generated week —
 * the current week is frozen — and the actions say so in their success copy.
 * Weekly-volume hints derive from PLAN_INTENSITY_TARGETS so tuning the
 * targets can never leave this copy stale.
 */
export function PlanSettings({
  examId,
  intensity,
  personalSittingOn,
  orgSittingOn,
}: {
  examId: string;
  intensity: PlanIntensity;
  personalSittingOn: string | null;
  /** The org's date, shown as the inherited default when no personal one. */
  orgSittingOn: string | null;
}) {
  const [intensityState, intensityFormAction] = useActionState<
    PlanActionState,
    FormData
  >(setIntensityAction, null);
  const [sittingState, sittingFormAction] = useActionState<
    PlanActionState,
    FormData
  >(setSittingDateAction, null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Plan settings</CardTitle>
        <CardDescription>
          Changes apply from next week — this week&apos;s goals stay put.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form action={intensityFormAction} className="space-y-3">
          <input type="hidden" name="examId" value={examId} />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Weekly intensity</legend>
            {(Object.keys(PLAN_INTENSITY_TARGETS) as PlanIntensity[]).map(
              (value) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <input
                    type="radio"
                    name="intensity"
                    value={value}
                    defaultChecked={intensity === value}
                    className="accent-primary"
                  />
                  <span className="font-medium">{INTENSITY_LABEL[value]}</span>
                  <span className="text-xs text-muted-foreground">
                    ~{PLAN_INTENSITY_TARGETS[value].questions} questions a week
                  </span>
                </label>
              )
            )}
          </fieldset>
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" variant="outline">
              Save intensity
            </Button>
          </div>
          <FormMessage
            error={intensityState?.error}
            success={intensityState?.success}
          />
        </form>

        <form action={sittingFormAction} className="space-y-3">
          <input type="hidden" name="examId" value={examId} />
          <div className="space-y-2">
            <Label htmlFor="plan-sitting">Your exam date</Label>
            <Input
              id="plan-sitting"
              type="date"
              name="sittingOn"
              defaultValue={personalSittingOn ?? ""}
              className="w-auto"
            />
            <p className="text-xs text-muted-foreground">
              {personalSittingOn === null && orgSittingOn !== null
                ? `Currently using your organisation's sitting date (${orgSittingOn}). Set your own to override it.`
                : "Optional — with a date, the plan ramps up as it approaches. Leave empty to clear."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" variant="outline">
              Save date
            </Button>
          </div>
          <FormMessage
            error={sittingState?.error}
            success={sittingState?.success}
          />
        </form>
      </CardContent>
    </Card>
  );
}
