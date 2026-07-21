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
  | "question.image.remove"
  | "option.correctness_change"
  | "exam.create"
  | "exam.rename"
  | "exam.delete"
  | "exam.reorder"
  | "specialty.create"
  | "specialty.rename"
  | "specialty.delete"
  | "specialty.reorder"
  | "subject.create"
  | "subject.rename"
  | "subject.delete"
  | "subject.reorder"
  | "topic.create"
  | "topic.rename"
  | "topic.delete"
  | "topic.reorder"
  | "topic.move_questions";

/**
 * Append an admin action to `audit_logs`.
 *
 * Call AFTER the mutation succeeds, and note that failures are swallowed on
 * purpose: losing an audit line must never roll back the content change it
 * describes. `target` stays a bare uuid so it is greppable; the entity type
 * lives in `action`. Put a diff in `meta`, not a snapshot — full stems would
 * bloat the table quickly.
 */
export async function audit(
  actorId: string,
  action: AuditAction,
  target?: string | null,
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    const { error } = await createAdminClient().from("audit_logs").insert({
      actor_id: actorId,
      action,
      target: target ?? null,
      meta: meta ?? null,
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    console.error("audit_log_failed", { action, target, error });
  }
}
