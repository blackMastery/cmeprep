import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type AuditAction =
  | "question.create"
  | "question.update"
  | "question.publish"
  | "question.unpublish"
  | "question.delete"
  | "question.restore"
  | "question.bulk_import"
  // Bulk actions write ONE summary row with target null and the ids in meta,
  // matching question.bulk_import — twenty rows per click would drown the log.
  | "question.bulk_publish"
  | "question.bulk_unpublish"
  | "question.bulk_delete"
  | "question.bulk_restore"
  | "question.image.remove"
  | "option.correctness_change"
  | "exam.create"
  | "exam.rename"
  | "exam.delete"
  | "exam.reorder"
  | "exam.availability"
  | "specialty.create"
  | "specialty.rename"
  | "specialty.delete"
  | "specialty.reorder"
  | "subject.create"
  | "subject.rename"
  | "subject.delete"
  | "subject.reorder"
  | "user.role_change"
  | "user.trials_change"
  | "user.reset_trials"
  | "user.ban"
  | "user.unban"
  | "subscription.create"
  | "subscription.update"
  | "subscription.cancel"
  | "plan.create"
  | "plan.update"
  | "plan.delete"
  | "plan.reorder"
  | "message.handle"
  | "message.reopen"
  | "message.delete"
  // Money-side events. A SUCCESSFUL capture gets no action of its own — the
  // payments row IS the record, and subscription.create already carries
  // paymentId/paypalOrderId/captureId in its meta. There is no
  // payment.amount_mismatch either: with amount_cents and plan_price_cents on
  // the row a mismatch is a SQL predicate, and an audit line would rot the
  // moment someone edited a plan price.
  | "payment.grant_failed"
  | "payment.refund"
  | "payment.refund_currency_mismatch"
  | "payment.denied"
  | "payment.reversed"
  // Reconciliation sweep. payment.reconcile is written every run, even a clean
  // one: a heartbeat in audit_logs is the only way anyone notices the cron has
  // stopped.
  | "payment.reconcile"
  | "payment.reconcile_repair"
  | "payment.reconcile_failed"
  // Org membership lifecycle (SPEC §4/§10). Bulk invites write ONE summary
  // row like question.bulk_import; org.member_join's actor is the joiner
  // (accepting an invite is the one org action a non-admin performs).
  | "org.invite"
  | "org.invite_revoke"
  | "org.invite_resend"
  | "org.member_join"
  | "org.member_remove"
  | "org.member_role_change"
  | "org.member_department_change"
  // Departments are hard-deleted (they are labels, not content), so the
  // delete row's meta carries the name — the only record left of it.
  | "org.department_create"
  | "org.department_rename"
  | "org.department_delete"
  // Org lifecycle + billing (SPEC §5/§11). org_subscription.create covers
  // BOTH grant paths — meta.via says whether PayPal or an admin did it.
  | "org.create"
  | "org.update"
  | "org.suspend"
  | "org.unsuspend"
  | "org_subscription.create"
  | "org_subscription.update"
  | "org_subscription.cancel"
  | "org.assignment_create"
  | "org.assignment_delete";

/**
 * Append an admin action to `audit_logs`.
 *
 * Call AFTER the mutation succeeds, and note that failures are swallowed on
 * purpose: losing an audit line must never roll back the content change it
 * describes. `target` stays a bare uuid so it is greppable; the entity type
 * lives in `action`. Put a diff in `meta`, not a snapshot — full stems would
 * bloat the table quickly.
 *
 * `actorId` is nullable because the reconciliation sweep has no actor.
 * audit_logs.actor_id is already nullable with an FK to profiles, so a sentinel
 * uuid would violate the FK — null is the only honest value.
 *
 * `orgId` scopes org-admin actions to their org's audit page; platform-admin
 * and system actions leave it null.
 */
export async function audit(
  actorId: string | null,
  action: AuditAction,
  target?: string | null,
  meta?: Record<string, unknown>,
  orgId?: string | null
): Promise<void> {
  try {
    const { error } = await createAdminClient().from("audit_logs").insert({
      actor_id: actorId,
      action,
      target: target ?? null,
      meta: meta ?? null,
      org_id: orgId ?? null,
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    console.error("audit_log_failed", { action, target, error });
  }
}
