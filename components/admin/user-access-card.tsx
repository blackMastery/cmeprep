"use client";

import { useActionState } from "react";
import { ShieldBan, ShieldCheck } from "lucide-react";
import {
  banUser,
  resetTrialsUsed,
  setTrialsLimit,
  unbanUser,
  updateUserRole,
} from "@/app/admin/users/actions";
import type { AdminState } from "@/app/admin/subjects/actions";
import type { Profile } from "@/lib/supabase/types";
import { ROLE_LABEL } from "@/lib/format";
import { USER_ROLES } from "@/lib/validation";
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

export function UserAccessCard({
  profile,
  isSelf,
}: {
  profile: Profile;
  isSelf: boolean;
}) {
  const [roleState, roleAction] = useActionState<AdminState, FormData>(
    updateUserRole,
    null
  );
  const [trialsState, trialsAction] = useActionState<AdminState, FormData>(
    setTrialsLimit,
    null
  );
  const [resetState, resetAction] = useActionState<AdminState, FormData>(
    resetTrialsUsed,
    null
  );
  const [banState, banAction] = useActionState<AdminState, FormData>(
    banUser,
    null
  );
  const [unbanState, unbanAction] = useActionState<AdminState, FormData>(
    unbanUser,
    null
  );

  const name = profile.full_name ?? "this user";

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-5">
        <h2 className="font-display text-lg">Role &amp; access</h2>

        {/* Role */}
        <form action={roleAction} className="space-y-3">
          <input type="hidden" name="userId" value={profile.id} />
          <FormMessage error={roleState?.error} success={roleState?.success} />
          <AdminSelect
            label="Role"
            name="role"
            defaultValue={profile.role}
            disabled={isSelf}
            hint={
              isSelf
                ? "You cannot change your own role."
                : "Subscription changes re-sync this automatically for non-admins."
            }
          >
            {USER_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </AdminSelect>
          {!isSelf && (
            <AdminSubmit variant="outline-muted" size="sm">
              Save role
            </AdminSubmit>
          )}
        </form>

        {/* Trials */}
        <div className="space-y-3 border-t border-border pt-5">
          <form action={trialsAction} className="space-y-3">
            <input type="hidden" name="userId" value={profile.id} />
            <FormMessage
              error={trialsState?.error}
              success={trialsState?.success}
            />
            <AdminField
              label="Trial test limit"
              name="trialsLimit"
              type="number"
              min={0}
              max={1000}
              required
              defaultValue={String(profile.trials_limit)}
              hint={`${profile.trials_used} used so far.`}
            />
            <AdminSubmit variant="outline-muted" size="sm">
              Save limit
            </AdminSubmit>
          </form>

          {profile.trials_used > 0 && (
            <form action={resetAction}>
              <input type="hidden" name="userId" value={profile.id} />
              <FormMessage
                error={resetState?.error}
                success={resetState?.success}
              />
              <ConfirmSubmit
                variant="ghost"
                size="sm"
                title="Reset used tests?"
                description={`${name} has used ${profile.trials_used} trial test${profile.trials_used === 1 ? "" : "s"}. Resetting returns their full allowance.`}
                confirmLabel="Reset"
              >
                Reset used tests to 0
              </ConfirmSubmit>
            </form>
          )}
        </div>

        {/* Ban */}
        {!isSelf && (
          <div className="space-y-3 border-t border-border pt-5">
            <FormMessage error={banState?.error ?? unbanState?.error} />
            {profile.banned_at ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm text-destructive">
                  <ShieldBan className="size-4" aria-hidden />
                  Banned {dateFormatter.format(new Date(profile.banned_at))}
                </p>
                <form action={unbanAction}>
                  <input type="hidden" name="userId" value={profile.id} />
                  <AdminSubmit variant="outline-muted" size="sm">
                    <ShieldCheck data-icon="inline-start" />
                    Unban
                  </AdminSubmit>
                </form>
              </div>
            ) : (
              <form action={banAction}>
                <input type="hidden" name="userId" value={profile.id} />
                <ConfirmSubmit
                  variant="destructive"
                  size="sm"
                  title={`Ban ${name}?`}
                  description="They are signed out of the app on their next request and see a banned notice instead of their dashboard. You can unban them at any time."
                  confirmLabel="Ban user"
                >
                  <ShieldBan data-icon="inline-start" />
                  Ban user
                </ConfirmSubmit>
              </form>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
