"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/admin/audit";
import {
  queueTestEmail,
  retryOutboxRow,
  testEmailOutcome,
} from "@/lib/admin/emails";
import { deliverOutbox } from "@/lib/email";
import {
  CATEGORY_LABEL,
  isEmailTemplate,
  TEMPLATE_CATEGORY,
} from "@/lib/email-core";
import { runNotificationScan } from "@/lib/notification-scans";
import { uuid } from "@/lib/validation";
import type { AdminState } from "@/app/admin/subjects/actions";

/**
 * requireAdmin() is the FIRST statement of every action, outside any
 * try/catch — see app/admin/questions/actions.ts for why.
 */

function revalidate() {
  revalidatePath("/admin/emails");
}

/** Run a cron job by hand — the same code the schedule calls. */
export async function runEmailJob(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const job = formData.get("job");
  if (job !== "deliver" && job !== "scan") return { error: "Unknown job." };

  try {
    if (job === "deliver") {
      // `manual`: the worker must not write the email.deliver heartbeat the
      // overview reads as "the schedule is alive".
      const summary = await deliverOutbox({ source: "manual" });
      await audit(user.id, "email.run", null, { job, ...summary });
      revalidate();
      return {
        success: `Delivery ran: ${summary.sent} sent, ${summary.skipped} skipped, ${summary.retried} retried, ${summary.failed} parked${summary.truncated ? " (stopped at the time budget)" : ""}.`,
      };
    }
    const summary = await runNotificationScan();
    await audit(user.id, "email.run", null, { job, ...summary });
    revalidate();
    const queued = summary.queued;
    return {
      success: `Scan ran: ${queued} email${queued === 1 ? "" : "s"} queued${summary.errors > 0 ? `, ${summary.errors} pass${summary.errors === 1 ? "" : "es"} failed (see the server log)` : ""}.`,
    };
  } catch (error) {
    // deliverOutbox throws only for EMAIL_TRANSPORT=resend without its keys.
    return { error: error instanceof Error ? error.message : "The job failed." };
  }
}

export async function retryEmail(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const id = uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown email." };

  if (!(await retryOutboxRow(id.data))) {
    return { error: "Only failed or skipped emails can be re-queued." };
  }
  await audit(user.id, "email.retry", id.data);
  revalidate();
  return { success: "Re-queued — the next delivery run will send it." };
}

/**
 * Send the template's sample to the signed-in admin — queued like any other
 * row, then delivered on the spot (that one row only, so a test never drains
 * the rest of the queue as a side effect). The message reports what the
 * worker actually did with it.
 */
export async function sendTestEmail(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const user = await requireAdmin();

  const template = formData.get("template");
  if (!isEmailTemplate(template)) return { error: "Pick a template." };

  const queued = await queueTestEmail(user.id, template);
  if (queued.outcome === "preference_off") {
    const category = TEMPLATE_CATEGORY[template];
    const title = category === "transactional" ? category : CATEGORY_LABEL[category].title;
    return {
      error: `Your own "${title}" toggle is off, so the worker would skip this. Turn it on in your profile first.`,
    };
  }
  if (queued.outcome === "failed") return { error: "Could not queue the test email." };
  await audit(user.id, "email.test", null, { template });

  try {
    await deliverOutbox({ dedupeKeys: [queued.dedupeKey] });
  } catch (error) {
    // EMAIL_TRANSPORT=resend without its keys: the row stays queued.
    revalidate();
    return { error: error instanceof Error ? error.message : "Delivery failed." };
  }
  revalidate();

  const row = await testEmailOutcome(queued.dedupeKey);
  switch (row?.status) {
    case "sent":
      return { success: `Sent to ${user.email}.` };
    case "skipped":
      return {
        success:
          row.skip_reason === "log_transport"
            ? `Rendered to the server console (transport is "log"); nothing was sent.`
            : `Not sent: ${row.skip_reason ?? "skipped"}.`,
      };
    case "failed":
      return { error: `Send failed: ${row.last_error ?? "unknown error"}` };
    case "queued":
      return {
        error: `Send failed and will retry: ${row.last_error ?? "unknown error"}`,
      };
    default:
      return { success: `Queued to ${user.email}.` };
  }
}
