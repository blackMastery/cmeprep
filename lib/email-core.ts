/**
 * Pure rules for outbound email (notifications-plan.md): the template
 * registry, which templates a student may switch off, every subject line and
 * body, the dedupe-key shapes, and the worker's retry arithmetic.
 *
 * No `server-only` and no DB: lib/email.ts does the sending and the outbox
 * IO, lib/notifications.ts and lib/notification-scans.ts decide WHEN to
 * queue. Keeping the copy here means vitest renders every template with a
 * sample payload, so a template that throws on a null field fails a test
 * rather than a Monday morning cron.
 *
 * Nothing rendered here may leak what the app protects: no correct answers,
 * no explanations, no exam-document titles, no per-member scores to anyone
 * who is not an org admin of that org.
 */

import { priceLabel } from "@/lib/format";
import { SITE_TIME_ZONE } from "@/lib/orgs-core";
import { absoluteUrl, SITE_NAME, SUPPORT_EMAIL } from "@/lib/site";
import { centsToValue } from "@/lib/subscriptions-core";

// ── Categories and preferences ──────────────────────────────

export const NOTIFICATION_CATEGORIES = [
  "expiry_reminders",
  "assignment_reminders",
  "report_updates",
  "weekly_digest",
  "org_admin_events",
  "org_assignment_summary",
  "admin_operations",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** The six toggles, as the profile card and the worker see them. */
export type NotificationPrefs = Record<NotificationCategory, boolean>;

/** Mirrors the column defaults in 20260909000001 — stated once here so an
 * absent preferences row and a fresh one behave identically. */
export const DEFAULT_PREFERENCES: NotificationPrefs = {
  expiry_reminders: true,
  assignment_reminders: true,
  report_updates: true,
  weekly_digest: false,
  org_admin_events: true,
  org_assignment_summary: true,
  admin_operations: true,
};

/** Copy for the profile card and the unsubscribe page. `org` marks the
 * toggles that only mean something to an org admin, `admin` the one only a
 * platform admin sees. */
export const CATEGORY_LABEL: Record<
  NotificationCategory,
  { title: string; description: string; org: boolean; admin: boolean }
> = {
  expiry_reminders: {
    title: "Access expiring",
    description: "A reminder a week before and the day before your access ends.",
    org: false,
    admin: false,
  },
  assignment_reminders: {
    title: "Assignments",
    description:
      "New assignments from your organisation, plus due-soon and overdue nudges.",
    org: false,
    admin: false,
  },
  report_updates: {
    title: "Question reports",
    description: "When a question you reported has been reviewed.",
    org: false,
    admin: false,
  },
  weekly_digest: {
    title: "Weekly summary",
    description: "A Monday recap of last week's practice, streak and weak areas.",
    org: false,
    admin: false,
  },
  org_admin_events: {
    title: "Organisation activity",
    description:
      "Members joining or leaving, reports on your questions, and access expiring.",
    org: true,
    admin: false,
  },
  org_assignment_summary: {
    title: "Assignment summaries",
    description: "Who finished and who didn't, once an assignment's deadline passes.",
    org: true,
    admin: false,
  },
  admin_operations: {
    title: "Platform operations",
    description:
      "Contact messages as they arrive, the daily queue digest, and OpenAI failure alerts.",
    org: false,
    admin: true,
  },
};

export function isNotificationCategory(x: unknown): x is NotificationCategory {
  return (
    typeof x === "string" &&
    (NOTIFICATION_CATEGORIES as readonly string[]).includes(x)
  );
}

// ── Templates ───────────────────────────────────────────────

export const EMAIL_TEMPLATES = [
  "purchase_receipt",
  "org_purchase_receipt",
  "refund_recorded",
  "payment_reversed",
  "access_expiring",
  "org_access_expiring",
  "org_invite",
  "org_member_joined",
  "org_member_removed",
  "org_member_removed_notice",
  "org_role_changed",
  "assignment_created",
  "assignment_due_soon",
  "assignment_overdue",
  "assignment_summary",
  "certificate_issued",
  "report_resolved",
  "org_question_reported",
  "weekly_digest",
  "admin_contact_message",
  "admin_question_reported",
  "admin_review_submitted",
  "admin_daily_digest",
  "admin_import_finished",
  "admin_failure_alert",
  "admin_role_changed",
] as const;

export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export function isEmailTemplate(x: unknown): x is EmailTemplate {
  return (
    typeof x === "string" && (EMAIL_TEMPLATES as readonly string[]).includes(x)
  );
}

/**
 * The one place that says which mail a student can switch off. Transactional
 * templates ignore preferences entirely: a receipt, a refund, an invite, a
 * removal, a role change and a certificate are records of something that
 * happened to the account, not marketing.
 */
export const TEMPLATE_CATEGORY: Record<
  EmailTemplate,
  NotificationCategory | "transactional"
> = {
  purchase_receipt: "transactional",
  org_purchase_receipt: "transactional",
  refund_recorded: "transactional",
  payment_reversed: "transactional",
  access_expiring: "expiry_reminders",
  org_access_expiring: "org_admin_events",
  org_invite: "transactional",
  org_member_joined: "org_admin_events",
  org_member_removed: "transactional",
  org_member_removed_notice: "org_admin_events",
  org_role_changed: "transactional",
  assignment_created: "assignment_reminders",
  assignment_due_soon: "assignment_reminders",
  assignment_overdue: "assignment_reminders",
  assignment_summary: "org_assignment_summary",
  certificate_issued: "transactional",
  report_resolved: "report_updates",
  org_question_reported: "org_admin_events",
  weekly_digest: "weekly_digest",
  admin_contact_message: "admin_operations",
  admin_question_reported: "admin_operations",
  admin_review_submitted: "admin_operations",
  admin_daily_digest: "admin_operations",
  // The importer asked for this by pressing Commit; it is the result.
  admin_import_finished: "transactional",
  admin_failure_alert: "admin_operations",
  // Security-relevant: every admin hears, and nobody can switch it off.
  admin_role_changed: "transactional",
};

/**
 * WHO a template is for, re-checked by the worker at delivery time: a row
 * is addressed when the event happens, and an admin demoted, an org admin
 * removed or a user banned in between (or before a Retry weeks later) must
 * not receive what they were addressed as. `org_admin` templates carry the
 * org in their payload (`orgId`) so the check has something to look up.
 */
export type TemplateAudience = "user" | "org_admin" | "platform_admin";

export const TEMPLATE_AUDIENCE: Record<EmailTemplate, TemplateAudience> = {
  purchase_receipt: "user",
  // Buyer AND admins; the buyer need not be one, so no admin re-check.
  org_purchase_receipt: "user",
  refund_recorded: "user",
  payment_reversed: "user",
  access_expiring: "user",
  org_access_expiring: "org_admin",
  org_invite: "user",
  org_member_joined: "org_admin",
  org_member_removed: "user",
  org_member_removed_notice: "org_admin",
  org_role_changed: "user",
  assignment_created: "user",
  assignment_due_soon: "user",
  assignment_overdue: "user",
  assignment_summary: "org_admin",
  certificate_issued: "user",
  report_resolved: "user",
  org_question_reported: "org_admin",
  weekly_digest: "user",
  admin_contact_message: "platform_admin",
  admin_question_reported: "platform_admin",
  admin_review_submitted: "platform_admin",
  admin_daily_digest: "platform_admin",
  admin_import_finished: "user",
  admin_failure_alert: "platform_admin",
  admin_role_changed: "platform_admin",
};

export function isTransactional(template: EmailTemplate): boolean {
  return TEMPLATE_CATEGORY[template] === "transactional";
}

/** Deliver this template to someone with these preferences? */
export function shouldDeliver(
  template: EmailTemplate,
  prefs: NotificationPrefs
): boolean {
  const category = TEMPLATE_CATEGORY[template];
  return category === "transactional" || prefs[category];
}

// ── Payloads ────────────────────────────────────────────────
// Everything a template needs, already resolved by the code that queued it.
// Paths are site-relative and absolutised at render time so a payload queued
// against one domain still renders against the current one.

export type ReportResolution = "fixed" | "no_change" | "not_actionable";

export type EmailPayloads = {
  purchase_receipt: {
    planName: string;
    /** null = every exam. */
    examName: string | null;
    amountLabel: string;
    accessUntil: string;
    paypalOrderId: string;
  };
  org_purchase_receipt: {
    orgName: string;
    planName: string;
    examName: string | null;
    amountLabel: string;
    accessUntil: string;
    paypalOrderId: string;
  };
  refund_recorded: {
    refundLabel: string;
    totalRefundedLabel: string;
    amountLabel: string;
    accessWithdrawn: boolean;
    paypalOrderId: string;
  };
  payment_reversed: {
    kind: "denied" | "reversed";
    amountLabel: string | null;
    paypalOrderId: string;
  };
  access_expiring: {
    examName: string | null;
    endsAt: string;
    daysLeft: number;
    renewPath: string;
  };
  org_access_expiring: {
    orgId: string;
    orgName: string;
    examName: string;
    endsAt: string;
    daysLeft: number;
  };
  org_invite: {
    orgName: string;
    inviterName: string | null;
    role: "admin" | "member";
    acceptPath: string;
    expiresAt: string;
  };
  org_member_joined: {
    orgId: string;
    orgName: string;
    memberName: string;
    role: "admin" | "member";
  };
  org_member_removed: { orgName: string };
  org_member_removed_notice: {
    orgId: string;
    orgName: string;
    memberName: string;
    removedByName: string;
  };
  org_role_changed: { orgName: string; role: "admin" | "member" };
  assignment_created: {
    orgName: string;
    title: string;
    dueAt: string;
    questionCount: number;
    mode: "exam" | "tutor";
  };
  assignment_due_soon: { orgName: string; title: string; dueAt: string };
  assignment_overdue: { orgName: string; title: string; dueAt: string };
  assignment_summary: {
    orgId: string;
    orgName: string;
    title: string;
    dueAt: string;
    targeted: number;
    completed: number;
    late: number;
    /** Mean of each finisher's latest qualifying score; null = nobody. */
    meanPct: number | null;
    notFinished: string[];
    /** Names past the cap in notFinished. */
    notFinishedMore: number;
  };
  certificate_issued: {
    courseTitle: string;
    credentialName: string;
    issuedAt: string;
    code: string;
    verifyPath: string;
    certificatesPath: string;
  };
  report_resolved: {
    count: number;
    resolution: ReportResolution;
    /** Stem excerpts, capped — never the answer or the explanation. */
    stems: string[];
  };
  org_question_reported: {
    orgId: string;
    orgName: string;
    stem: string;
    category: string | null;
    reportsPath: string;
  };
  weekly_digest: {
    weekLabel: string;
    attempts: number;
    correct: number;
    accuracyPct: number | null;
    streak: number;
    weakSubjects: { name: string; accuracyPct: number }[];
    /** The student has study-plan settings — this week's plan is a click away. */
    hasPlan: boolean;
  };
  // ── Platform admins ────────────────────────────────────────
  admin_contact_message: {
    messageId: string;
    name: string;
    email: string;
    subject: string;
    /** First CONTACT_EXCERPT_CHARS of the body; the page has the rest. */
    excerpt: string;
    messagesPath: string;
  };
  admin_question_reported: {
    stem: string;
    category: string | null;
    examName: string;
    subjectName: string;
    /** Open reports on this question, the new one included. */
    openReports: number;
    reportsPath: string;
  };
  admin_review_submitted: {
    reviewId: string;
    rating: number;
    displayName: string;
    examName: string | null;
    verifiedPurchase: boolean;
    /** The review body — pre-moderation, so an admin reads the words. */
    body: string;
    /** Reviews waiting on a verdict, this one included. */
    pendingReviews: number;
    reviewsPath: string;
  };
  admin_daily_digest: {
    dayLabel: string;
    newMessages: number;
    openMessages: number;
    newReports: number;
    /** Open report rollups — questions, not reports (the nav badge figure). */
    openReportQuestions: number;
    pendingReviews: number;
  };
  admin_import_finished: {
    examName: string;
    fileName: string;
    imported: number;
    skipped: number;
    errorRows: number;
    images: number;
    createdSpecialties: number;
    createdSubjects: number;
    questionsPath: string;
  };
  admin_failure_alert: {
    kind: FailureAlertKind;
    failures: number;
    calls: number;
    windowHours: number;
    threshold: number;
    logPath: string;
  };
  admin_role_changed: {
    targetName: string;
    targetEmail: string | null;
    before: string;
    after: string;
    actorName: string;
    usersPath: string;
  };
};

export type FailureAlertKind = "osce_grading" | "translation";

export const FAILURE_ALERT_LABEL: Record<FailureAlertKind, string> = {
  osce_grading: "OSCE grading",
  translation: "Translation",
};

// ── Dedupe keys ─────────────────────────────────────────────
// One builder per template so the shape is stated once. A key names the
// EVENT, never the attempt to send it: two code paths reacting to one grant
// build the same key and the unique index keeps one row.

export const dedupeKey = {
  receipt: (paypalOrderId: string) => `receipt:${paypalOrderId}`,
  orgReceipt: (paypalOrderId: string, userId: string) =>
    `org_receipt:${paypalOrderId}:${userId}`,
  refund: (refundId: string) => `refund:${refundId}`,
  reversal: (kind: "denied" | "reversed", paymentId: string) =>
    `reversal:${kind}:${paymentId}`,
  /** A renewal moves periodEnd, which re-arms the key naturally. */
  expiry: (
    userId: string,
    examId: string | null,
    periodEnd: string,
    stage: ExpiryStage
  ) => `expiry:${userId}:${examId ?? "all"}:${periodEnd}:${stage}`,
  orgExpiry: (
    orgId: string,
    examId: string,
    periodEnd: string,
    stage: ExpiryStage,
    adminId: string
  ) => `org_expiry:${orgId}:${examId}:${periodEnd}:${stage}:${adminId}`,
  /** expiresAt changes on renew/resend, so each of those sends again. */
  orgInvite: (inviteId: string, expiresAt: string) =>
    `org_invite:${inviteId}:${expiresAt}`,
  orgMemberJoined: (inviteId: string, adminId: string) =>
    `org_member_joined:${inviteId}:${adminId}`,
  orgMemberRemoved: (orgId: string, userId: string, at: string) =>
    `org_member_removed:${orgId}:${userId}:${at}`,
  orgMemberRemovedNotice: (
    orgId: string,
    userId: string,
    at: string,
    adminId: string
  ) => `org_member_removed_notice:${orgId}:${userId}:${at}:${adminId}`,
  orgRoleChanged: (orgId: string, userId: string, at: string) =>
    `org_role_changed:${orgId}:${userId}:${at}`,
  assignmentCreated: (assignmentId: string, userId: string) =>
    `assign_created:${assignmentId}:${userId}`,
  assignmentDue: (assignmentId: string, userId: string) =>
    `assign_due:${assignmentId}:${userId}`,
  assignmentOverdue: (assignmentId: string, userId: string) =>
    `assign_overdue:${assignmentId}:${userId}`,
  assignmentSummary: (assignmentId: string, adminId: string) =>
    `assign_summary:${assignmentId}:${adminId}`,
  certificate: (certificateId: string) => `certificate:${certificateId}`,
  /** A report closes exactly once, so the lowest id of the batch anchors
   * the grouped mail: stable, and never longer than one uuid. */
  reportResolved: (userId: string, anchorReportId: string) =>
    `report_resolved:${userId}:${anchorReportId}`,
  orgQuestionReported: (reportId: string, adminId: string) =>
    `org_report:${reportId}:${adminId}`,
  digest: (userId: string, weekStart: string) => `digest:${userId}:${weekStart}`,
  adminContact: (messageId: string, adminId: string) =>
    `admin_contact:${messageId}:${adminId}`,
  /**
   * Batched per QUESTION: keyed on the oldest open report, so five reports
   * on one question are one mail, and the key re-arms only after the
   * question is resolved (the next report becomes the oldest open one).
   */
  adminQuestionReported: (anchorReportId: string, adminId: string) =>
    `admin_report:${anchorReportId}:${adminId}`,
  adminReview: (reviewId: string, adminId: string) =>
    `admin_review:${reviewId}:${adminId}`,
  adminDigest: (day: string, adminId: string) => `admin_digest:${day}:${adminId}`,
  /** Importing the same file twice is two imports; the instant keys it. */
  adminImport: (userId: string, at: string) => `admin_import:${userId}:${at}`,
  adminFailure: (kind: FailureAlertKind, day: string, adminId: string) =>
    `admin_failure:${kind}:${day}:${adminId}`,
  adminRoleChanged: (targetId: string, at: string, adminId: string) =>
    `admin_role:${targetId}:${at}:${adminId}`,
  /** Sent from /admin/emails; every press is a fresh row on purpose. */
  test: (template: EmailTemplate, userId: string, at: string) =>
    `test:${template}:${userId}:${at}`,
} as const;

// ── Scan rules ──────────────────────────────────────────────

export type ExpiryStage = 7 | 1;

/**
 * Which reminder a warning with this many days left earns. The 7-day stage
 * covers 2–7 so a scan that missed the exact day still sends once (the key
 * is per stage, so never twice); the 1-day stage is exact — a "tomorrow"
 * mail sent on the day itself would be a lie.
 */
export function expiryReminderStage(daysLeft: number): ExpiryStage | null {
  if (daysLeft === 1) return 1;
  if (daysLeft >= 2 && daysLeft <= 7) return 7;
  return null;
}

/** Assignment reminders look this far ahead ("due soon") and behind
 * ("overdue"); summaries a little further back so a skipped scan day still
 * produces one (the key makes a late summary a single summary). */
export const DUE_SOON_HOURS = 48;
/** Two scan intervals, like the summary: one missed or truncated daily run
 * must delay a reminder, never lose it (the per-member key makes a second
 * sighting a no-op). */
export const OVERDUE_HOURS = 48;
export const SUMMARY_LOOKBACK_HOURS = 48;

/** Names listed in an assignment summary before "and N more". */
export const SUMMARY_NAME_CAP = 30;

/** Stems quoted in a grouped report_resolved mail. */
export const REPORT_STEM_CAP = 5;

/** Weakest subjects in the digest, and the attempts a subject needs to
 * count — the same floor the dashboard's weak-areas card uses. */
export const DIGEST_WEAK_SUBJECTS = 3;
export const DIGEST_SUBJECT_MIN_ATTEMPTS = 5;

/** Body characters quoted in the admin contact-message mail. */
export const CONTACT_EXCERPT_CHARS = 400;

/**
 * OpenAI failure alerts: failed calls in the trailing window before an
 * admin is told. Five, not one — a single timeout is weather; five in a day
 * is a key, a quota or an outage. Both kinds share the figure so retuning
 * is one edit.
 */
export const FAILURE_ALERT_THRESHOLD = 5;
export const FAILURE_ALERT_WINDOW_HOURS = 24;

/** Should the admin digest go out at all? An empty day is silence, not a
 * mail that says "nothing" — the daily email.scan audit row is the
 * heartbeat. Pending queues count as news until they are cleared. */
export function adminDigestWorthSending(
  d: Pick<
    EmailPayloads["admin_daily_digest"],
    "newMessages" | "openMessages" | "newReports" | "openReportQuestions" | "pendingReviews"
  >
): boolean {
  return (
    d.newMessages + d.openMessages + d.newReports + d.openReportQuestions + d.pendingReviews >
    0
  );
}

/** At or past the threshold? Stated once so the scan and the test agree. */
export function failureAlertDue(failures: number): boolean {
  return failures >= FAILURE_ALERT_THRESHOLD;
}

/**
 * Group rows by user so one ruling on many reports produces one mail per
 * reporter. Insertion order is preserved; callers sort ids for the key.
 */
export function groupByUser<T extends { user_id: string }>(
  rows: readonly T[]
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const list = out.get(row.user_id) ?? [];
    list.push(row);
    out.set(row.user_id, list);
  }
  return out;
}

/** First `max` characters of a stem on one line, with an ellipsis. */
export function stemExcerpt(stem: string, max = 90): string {
  const flat = stem.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

// ── Delivery arithmetic ─────────────────────────────────────

export const OUTBOX_BATCH = 50;
/** Provider hiccups retry; a row that fails this many times is parked as
 * `failed` with its last error, for a human. */
export const MAX_SEND_ATTEMPTS = 5;
/** Of the route's maxDuration 60 — same headroom as the reconcile sweep. */
export const EMAIL_BUDGET_MS = 45_000;
const RETRY_BASE_MINUTES = 15;

/** After a failed attempt: park, or back off (15, 30, 45… minutes). */
export function afterFailedAttempt(
  attempts: number,
  now: Date
): { status: "queued" | "failed"; scheduledFor: string } {
  if (attempts >= MAX_SEND_ATTEMPTS) {
    return { status: "failed", scheduledFor: now.toISOString() };
  }
  const delayMs = RETRY_BASE_MINUTES * attempts * 60_000;
  return {
    status: "queued",
    scheduledFor: new Date(now.getTime() + delayMs).toISOString(),
  };
}

// ── Formatting ──────────────────────────────────────────────

/** "9 September 2026" in the site's timezone. */
export function formatDateLong(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: SITE_TIME_ZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

/** "$144.00 USD" — cents plus the ISO code, since PayPal settles in more
 * than one currency and a bare "$" is ambiguous on a receipt. */
export function moneyLabel(cents: number, currency: string | null): string {
  // centsToValue is the same rule PayPal is charged with — one statement.
  return currency ? `$${centsToValue(cents)} ${currency}` : priceLabel(cents);
}

const RESOLUTION_COPY: Record<ReportResolution, string> = {
  fixed: "the question has been corrected",
  no_change: "the question was reviewed and stands as written",
  not_actionable: "the question has been retired or the report could not be acted on",
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ── Rendering ───────────────────────────────────────────────

export type RenderContext = {
  /** null for transactional mail (nothing to unsubscribe from). */
  unsubscribeUrl: string | null;
};

export type RenderedEmail = { subject: string; text: string; html: string };

type Draft = {
  subject: string;
  heading: string;
  /** Plain sentences; the HTML layout wraps each in a paragraph. */
  paragraphs: string[];
  /** Rendered as a bulleted list between the paragraphs and the button. */
  items?: string[];
  cta?: { label: string; path: string };
  /** Small print under the button (order ids, verify codes). */
  footnote?: string;
};

function draftFor<T extends EmailTemplate>(
  template: T,
  p: EmailPayloads[T]
): Draft {
  // TypeScript cannot narrow a generic payload by the template string, so
  // each branch casts — the EmailPayloads map is still the contract callers
  // are held to.
  switch (template) {
    case "purchase_receipt": {
      const d = p as EmailPayloads["purchase_receipt"];
      return {
        subject: `Your ${SITE_NAME} receipt — ${d.planName}`,
        heading: "Thanks for your purchase",
        paragraphs: [
          `Your payment for the ${d.planName} plan has gone through.`,
        ],
        items: [
          `Access: ${d.examName ?? "every examination"}`,
          `Amount: ${d.amountLabel}`,
          `Access until: ${formatDateLong(d.accessUntil)}`,
        ],
        cta: { label: "Start practising", path: "/dashboard" },
        footnote: `PayPal order ${d.paypalOrderId}. Keep this email as your receipt.`,
      };
    }
    case "org_purchase_receipt": {
      const d = p as EmailPayloads["org_purchase_receipt"];
      return {
        subject: `Receipt for ${d.orgName} — ${d.planName}`,
        heading: `${d.orgName} is set up`,
        paragraphs: [
          `The ${d.planName} plan has been paid for and applied to ${d.orgName}.`,
        ],
        items: [
          `Access: ${d.examName ?? "every examination"}`,
          `Amount: ${d.amountLabel}`,
          `Access until: ${formatDateLong(d.accessUntil)}`,
        ],
        cta: { label: "Open billing", path: "/org/billing" },
        footnote: `PayPal order ${d.paypalOrderId}. Keep this email as your receipt.`,
      };
    }
    case "refund_recorded": {
      const d = p as EmailPayloads["refund_recorded"];
      return {
        subject: `Refund of ${d.refundLabel} recorded`,
        heading: "A refund has been recorded",
        paragraphs: [
          `PayPal has refunded ${d.refundLabel} of your ${d.amountLabel} payment. Total refunded so far: ${d.totalRefundedLabel}.`,
          d.accessWithdrawn
            ? "Because the payment was refunded in full, the access it bought has been withdrawn."
            : "Your access is unchanged — a partial refund never shortens what you paid for.",
        ],
        cta: { label: "View your subscription", path: "/profile" },
        footnote: `PayPal order ${d.paypalOrderId}.`,
      };
    }
    case "payment_reversed": {
      const d = p as EmailPayloads["payment_reversed"];
      const what =
        d.kind === "denied"
          ? "PayPal declined to fund your payment"
          : "your payment was reversed by a chargeback";
      return {
        subject:
          d.kind === "denied" ? "Your payment did not go through" : "Your payment was reversed",
        heading: "Access withdrawn",
        paragraphs: [
          `We're sorry — ${what}${d.amountLabel ? ` (${d.amountLabel})` : ""}, so the access it bought has been withdrawn.`,
          `If this is a mistake, reply to this email or write to ${SUPPORT_EMAIL} and we'll sort it out.`,
        ],
        footnote: `PayPal order ${d.paypalOrderId}.`,
      };
    }
    case "access_expiring": {
      const d = p as EmailPayloads["access_expiring"];
      const what = d.examName ?? "all examinations";
      return {
        subject:
          d.daysLeft === 1
            ? `Your ${what} access ends tomorrow`
            : `Your ${what} access ends in ${plural(d.daysLeft, "day")}`,
        heading: d.daysLeft === 1 ? "Ends tomorrow" : `${plural(d.daysLeft, "day")} left`,
        paragraphs: [
          `Your access to ${what} ends on ${formatDateLong(d.endsAt)}. Renew now and the new period starts where this one ends — you never lose a day.`,
        ],
        cta: { label: "Renew access", path: d.renewPath },
      };
    }
    case "org_access_expiring": {
      const d = p as EmailPayloads["org_access_expiring"];
      return {
        subject: `${d.orgName}: ${d.examName} access ends in ${plural(d.daysLeft, "day")}`,
        heading: `${d.examName} access is ending`,
        paragraphs: [
          `${d.orgName}'s access to ${d.examName} ends on ${formatDateLong(d.endsAt)}. After that, members keep a 14-day grace period before the bank locks.`,
        ],
        cta: { label: "Renew for your organisation", path: "/org/billing" },
      };
    }
    case "org_invite": {
      const d = p as EmailPayloads["org_invite"];
      return {
        subject: `You're invited to join ${d.orgName}`,
        heading: `Join ${d.orgName}`,
        paragraphs: [
          `${d.inviterName ?? "An administrator"} has invited you to join ${d.orgName} on ${SITE_NAME} as ${d.role === "admin" ? "an administrator" : "a member"}.`,
          `Your organisation sees your aggregate performance, not your individual answers. The invite is open until ${formatDateLong(d.expiresAt)}.`,
        ],
        cta: { label: "Accept the invite", path: d.acceptPath },
      };
    }
    case "org_member_joined": {
      const d = p as EmailPayloads["org_member_joined"];
      return {
        subject: `${d.memberName} joined ${d.orgName}`,
        heading: "New member",
        paragraphs: [
          `${d.memberName} accepted their invite and joined ${d.orgName} as ${d.role === "admin" ? "an administrator" : "a member"}.`,
        ],
        cta: { label: "View members", path: "/org/members" },
      };
    }
    case "org_member_removed": {
      const d = p as EmailPayloads["org_member_removed"];
      return {
        subject: `You've been removed from ${d.orgName}`,
        heading: `Removed from ${d.orgName}`,
        paragraphs: [
          `An administrator has removed you from ${d.orgName}. Your personal account, your history and any subscription you bought yourself are untouched — only the organisation's access has ended.`,
        ],
        cta: { label: "Go to your dashboard", path: "/dashboard" },
      };
    }
    case "org_member_removed_notice": {
      const d = p as EmailPayloads["org_member_removed_notice"];
      return {
        subject: `${d.memberName} was removed from ${d.orgName}`,
        heading: "Member removed",
        paragraphs: [
          `${d.removedByName} removed ${d.memberName} from ${d.orgName}. Their seat is free again.`,
        ],
        cta: { label: "View members", path: "/org/members" },
      };
    }
    case "org_role_changed": {
      const d = p as EmailPayloads["org_role_changed"];
      return {
        subject:
          d.role === "admin"
            ? `You're now an administrator of ${d.orgName}`
            : `Your role in ${d.orgName} has changed`,
        heading: d.role === "admin" ? "You're an administrator" : "Role changed",
        paragraphs: [
          d.role === "admin"
            ? `You can now manage members, assignments and billing for ${d.orgName}.`
            : `You are now a member of ${d.orgName}, without administrator access.`,
        ],
        cta:
          d.role === "admin"
            ? { label: "Open the organisation", path: "/org" }
            : { label: "Go to your dashboard", path: "/dashboard" },
      };
    }
    case "assignment_created": {
      const d = p as EmailPayloads["assignment_created"];
      return {
        subject: `New assignment from ${d.orgName}: ${d.title}`,
        heading: d.title,
        paragraphs: [
          `${d.orgName} has assigned you ${plural(d.questionCount, "question")} in ${d.mode} mode, due ${formatDateLong(d.dueAt)}.`,
        ],
        cta: { label: "Start the assignment", path: "/assignments" },
      };
    }
    case "assignment_due_soon": {
      const d = p as EmailPayloads["assignment_due_soon"];
      return {
        subject: `Due soon: ${d.title}`,
        heading: "Due soon",
        paragraphs: [
          `"${d.title}" from ${d.orgName} is due ${formatDateLong(d.dueAt)} and you haven't submitted it yet.`,
        ],
        cta: { label: "Open assignments", path: "/assignments" },
      };
    }
    case "assignment_overdue": {
      const d = p as EmailPayloads["assignment_overdue"];
      return {
        subject: `Overdue: ${d.title}`,
        heading: "Overdue",
        paragraphs: [
          `"${d.title}" from ${d.orgName} was due ${formatDateLong(d.dueAt)}. A late submission still counts — it's just flagged as late.`,
        ],
        cta: { label: "Open assignments", path: "/assignments" },
      };
    }
    case "assignment_summary": {
      const d = p as EmailPayloads["assignment_summary"];
      const items = [
        `Completed: ${d.completed} of ${d.targeted}${d.late > 0 ? ` (${d.late} late)` : ""}`,
        `Average score: ${d.meanPct === null ? "—" : `${d.meanPct}%`}`,
      ];
      if (d.notFinished.length > 0) {
        items.push(
          `Not finished: ${d.notFinished.join(", ")}${d.notFinishedMore > 0 ? ` and ${d.notFinishedMore} more` : ""}`
        );
      }
      return {
        subject: `${d.title}: ${d.completed} of ${d.targeted} completed`,
        heading: `${d.title} has closed`,
        paragraphs: [
          `The deadline for "${d.title}" (${d.orgName}) passed on ${formatDateLong(d.dueAt)}.`,
        ],
        items,
        cta: { label: "View the report", path: "/org/assignments" },
      };
    }
    case "certificate_issued": {
      const d = p as EmailPayloads["certificate_issued"];
      return {
        subject: `Your certificate: ${d.courseTitle}`,
        heading: "Congratulations",
        paragraphs: [
          `${d.credentialName}, your certificate of completion for "${d.courseTitle}" was issued on ${formatDateLong(d.issuedAt)}.`,
          `Anyone can confirm it at ${absoluteUrl(d.verifyPath)} using the code below.`,
        ],
        cta: { label: "Download your certificate", path: d.certificatesPath },
        footnote: `Certificate code ${d.code}.`,
      };
    }
    case "report_resolved": {
      const d = p as EmailPayloads["report_resolved"];
      const many = d.count > 1;
      return {
        subject: many
          ? `${d.count} of your question reports were reviewed`
          : "Your question report was reviewed",
        heading: many ? "Reports reviewed" : "Report reviewed",
        paragraphs: [
          `Thanks for flagging ${many ? "these questions" : "this question"} — ${RESOLUTION_COPY[d.resolution]}.`,
        ],
        items: d.stems,
        cta: { label: "Back to practice", path: "/dashboard" },
      };
    }
    case "org_question_reported": {
      const d = p as EmailPayloads["org_question_reported"];
      return {
        subject: `A question in ${d.orgName}'s bank was reported`,
        heading: "Question reported",
        paragraphs: [
          `A member reported one of ${d.orgName}'s questions${d.category ? ` as "${d.category.replace(/_/g, " ")}"` : ""}:`,
        ],
        items: [d.stem],
        cta: { label: "Review the report", path: d.reportsPath },
      };
    }
    case "weekly_digest": {
      const d = p as EmailPayloads["weekly_digest"];
      const items = [
        `Questions answered: ${d.attempts} (${d.correct} correct${d.accuracyPct === null ? "" : `, ${d.accuracyPct}%`})`,
        `Day streak: ${d.streak}`,
        ...d.weakSubjects.map((s) => `Weakest: ${s.name} — ${s.accuracyPct}%`),
      ];
      return {
        subject: `Your week on ${SITE_NAME}: ${d.weekLabel}`,
        heading: "Last week",
        paragraphs: [
          d.hasPlan
            ? "Here's how last week went. This week's study plan is waiting for you."
            : "Here's how last week went.",
        ],
        items,
        cta: d.hasPlan
          ? { label: "Open this week's plan", path: "/plan" }
          : { label: "Start a test", path: "/tests/new" },
      };
    }
    case "admin_contact_message": {
      const d = p as EmailPayloads["admin_contact_message"];
      return {
        subject: `Contact: ${d.subject} — ${d.name}`,
        heading: "New contact message",
        paragraphs: [
          `${d.name} (${d.email}) wrote about "${d.subject}":`,
          d.excerpt,
        ],
        cta: { label: "Open in Messages", path: d.messagesPath },
        footnote: `Reply to ${d.email} directly; marking it handled happens in the admin.`,
      };
    }
    case "admin_question_reported": {
      const d = p as EmailPayloads["admin_question_reported"];
      const many = d.openReports > 1;
      return {
        subject: many
          ? `${d.openReports} reports on a ${d.examName} question`
          : `A ${d.examName} question was reported`,
        heading: "Question reported",
        paragraphs: [
          `A student reported a ${d.subjectName} question in ${d.examName}${d.category ? ` as "${d.category.replace(/_/g, " ")}"` : ""}${many ? ` — it now has ${d.openReports} open reports` : ""}:`,
        ],
        items: [d.stem],
        cta: { label: "Open the report queue", path: d.reportsPath },
        footnote:
          "Further reports on this question will not email again until it is resolved.",
      };
    }
    case "admin_review_submitted": {
      const d = p as EmailPayloads["admin_review_submitted"];
      const stars = "★".repeat(d.rating) + "☆".repeat(Math.max(0, 5 - d.rating));
      return {
        subject: `New ${d.rating}-star review from ${d.displayName} awaiting moderation`,
        heading: "Review awaiting moderation",
        paragraphs: [
          `${d.displayName}${d.examName ? ` (${d.examName})` : ""}${d.verifiedPurchase ? ", verified purchase," : ""} left ${stars}:`,
          d.body,
          `${d.pendingReviews} review${d.pendingReviews === 1 ? " is" : "s are"} waiting on a verdict. Nothing is public until you approve it.`,
        ],
        cta: { label: "Moderate reviews", path: d.reviewsPath },
      };
    }
    case "admin_daily_digest": {
      const d = p as EmailPayloads["admin_daily_digest"];
      return {
        subject: `Admin digest, ${d.dayLabel}: ${d.openMessages} messages, ${d.openReportQuestions} reported questions, ${d.pendingReviews} reviews`,
        heading: `Queues on ${d.dayLabel}`,
        paragraphs: ["What came in over the last day, and what is still waiting."],
        items: [
          `Contact messages: ${d.newMessages} new, ${d.openMessages} waiting on a reply`,
          `Question reports: ${d.newReports} new, ${d.openReportQuestions} questions with open reports`,
          `Product reviews: ${d.pendingReviews} pending moderation`,
        ],
        cta: { label: "Open the admin", path: "/admin" },
      };
    }
    case "admin_import_finished": {
      const d = p as EmailPayloads["admin_import_finished"];
      return {
        subject: `Import finished: ${d.imported} questions into ${d.examName}`,
        heading: "Import finished",
        paragraphs: [
          `"${d.fileName}" has been imported into ${d.examName}. Every row landed as a draft; publish them from the questions list.`,
        ],
        items: [
          `Imported: ${d.imported}`,
          `Skipped: ${d.skipped}`,
          `Rows with errors: ${d.errorRows}`,
          `Images uploaded: ${d.images}`,
          `Taxonomy created: ${d.createdSpecialties} specialties, ${d.createdSubjects} subjects`,
        ],
        cta: { label: "Review the drafts", path: d.questionsPath },
      };
    }
    case "admin_failure_alert": {
      const d = p as EmailPayloads["admin_failure_alert"];
      const label = FAILURE_ALERT_LABEL[d.kind];
      return {
        subject: `${label}: ${d.failures} failed calls in ${d.windowHours}h`,
        heading: `${label} is failing`,
        paragraphs: [
          `${d.failures} of ${d.calls} ${label.toLowerCase()} calls to OpenAI failed in the last ${d.windowHours} hours (alert threshold ${d.threshold}). Students see "unavailable" and retry; nothing is lost, but nothing is working either.`,
          "Check the API key, the quota and OpenAI's status page, then the log below for the error text.",
        ],
        cta: { label: "Open the log", path: d.logPath },
      };
    }
    case "admin_role_changed": {
      const d = p as EmailPayloads["admin_role_changed"];
      const granted = d.after === "admin";
      return {
        subject: granted
          ? `Admin access granted to ${d.targetName}`
          : `Admin access removed from ${d.targetName}`,
        heading: granted ? "New administrator" : "Administrator removed",
        paragraphs: [
          `${d.actorName} changed ${d.targetName}${d.targetEmail ? ` (${d.targetEmail})` : ""} from ${d.before} to ${d.after}.`,
          "Every administrator receives this. If you did not expect it, check the audit log and the user's page now.",
        ],
        cta: { label: "Open the user", path: d.usersPath },
      };
    }
  }
  // Every template is handled above; an unknown one is a programming error
  // and must not produce a blank email.
  throw new Error(`unknown email template: ${String(template)}`);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Subject + plain text + HTML for one template. The HTML is deliberately
 * table-free and inline-styled — email clients, not browsers — and every
 * dynamic string is escaped. Brand colours are the crimson band and ink
 * text from app/globals.css, hard-coded because email cannot load CSS.
 */
export function renderEmail<T extends EmailTemplate>(
  template: T,
  payload: EmailPayloads[T],
  ctx: RenderContext
): RenderedEmail {
  const draft = draftFor(template, payload);
  const ctaUrl = draft.cta ? absoluteUrl(draft.cta.path) : null;

  const textLines: string[] = [draft.heading, ""];
  for (const para of draft.paragraphs) textLines.push(para, "");
  if (draft.items && draft.items.length > 0) {
    for (const item of draft.items) textLines.push(`• ${item}`);
    textLines.push("");
  }
  if (draft.cta && ctaUrl) textLines.push(`${draft.cta.label}: ${ctaUrl}`, "");
  if (draft.footnote) textLines.push(draft.footnote, "");
  textLines.push(`— ${SITE_NAME}`, `Questions? ${SUPPORT_EMAIL}`);
  if (ctx.unsubscribeUrl) {
    textLines.push("", `Turn off these emails: ${ctx.unsubscribeUrl}`);
  }

  const paragraphsHtml = draft.paragraphs
    .map(
      (para) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#1f1a1c">${escapeHtml(para)}</p>`
    )
    .join("");
  const itemsHtml =
    draft.items && draft.items.length > 0
      ? `<ul style="margin:0 0 16px;padding-left:20px;font-size:16px;line-height:1.6;color:#1f1a1c">${draft.items
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join("")}</ul>`
      : "";
  const ctaHtml =
    draft.cta && ctaUrl
      ? `<p style="margin:24px 0"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#9b1b30;color:#ffffff;font-weight:600;text-decoration:none">${escapeHtml(draft.cta.label)}</a></p>`
      : "";
  const footnoteHtml = draft.footnote
    ? `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#6b6266">${escapeHtml(draft.footnote)}</p>`
    : "";
  const unsubscribeHtml = ctx.unsubscribeUrl
    ? `<p style="margin:8px 0 0;font-size:12px;color:#8a8186"><a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color:#8a8186">Turn off these emails</a></p>`
    : "";

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f3f4;font-family:'Public Sans',Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#9b1b30;color:#ffffff;padding:16px 24px;border-radius:12px 12px 0 0;font-family:Poppins,Helvetica,Arial,sans-serif;font-weight:600;font-size:18px">${escapeHtml(SITE_NAME)}</div>
  <div style="background:#ffffff;padding:24px;border-radius:0 0 12px 12px">
    <h1 style="margin:0 0 16px;font-family:Poppins,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;color:#1f1a1c">${escapeHtml(draft.heading)}</h1>
    ${paragraphsHtml}${itemsHtml}${ctaHtml}${footnoteHtml}
    <p style="margin:16px 0 0;font-size:13px;color:#6b6266">Questions? <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:#9b1b30">${escapeHtml(SUPPORT_EMAIL)}</a></p>
    ${unsubscribeHtml}
  </div>
</div>
</body></html>`;

  return { subject: draft.subject, text: textLines.join("\n"), html };
}
