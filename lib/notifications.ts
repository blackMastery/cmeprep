import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  CONTACT_EXCERPT_CHARS,
  dedupeKey,
  groupByUser,
  moneyLabel,
  REPORT_STEM_CAP,
  stemExcerpt,
  type EmailPayloads,
} from "@/lib/email-core";
import {
  enqueueEmail,
  enqueueEmails,
  orgAdminRecipients,
  platformAdminRecipients,
  type EnqueueInput,
} from "@/lib/email";
import { assignmentAudienceUserIds } from "@/lib/orgs";
import type {
  CourseCertificate,
  OrgAssignment,
  OrgMemberRole,
  QuestionReportResolution,
} from "@/lib/supabase/types";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Event-driven notifications (notifications-plan.md phases 1, 3, 4, 5): one
 * helper per event, called by the code path that made the event happen,
 * AFTER its write has committed. Each resolves the names and labels the
 * template needs and queues outbox rows; none of them throw (enqueueEmail
 * swallows), so a notification can never fail the action it describes.
 *
 * The time-based ones (expiry, due dates, the digest) are in
 * lib/notification-scans.ts.
 */

async function examNameFor(
  admin: AdminClient,
  examId: string | null
): Promise<string | null> {
  if (examId === null) return null;
  const { data } = await admin
    .from("exams")
    .select("name")
    .eq("id", examId)
    .maybeSingle();
  return data?.name ?? null;
}

async function orgNameFor(admin: AdminClient, orgId: string): Promise<string> {
  const { data } = await admin
    .from("orgs")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();
  return data?.name ?? "your organisation";
}

async function displayNameFor(
  admin: AdminClient,
  userId: string | null,
  fallback: string
): Promise<string> {
  if (!userId) return fallback;
  const { data } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  return data?.full_name?.trim() || fallback;
}

/** What the buyer paid, from the payments row written before the grant;
 * the plan's list price when the capture carried no amount. */
async function amountLabelFor(
  admin: AdminClient,
  paypalOrderId: string,
  planId: string
): Promise<string> {
  const { data: payment } = await admin
    .from("payments")
    .select("amount_cents, currency, plan_price_cents")
    .eq("paypal_order_id", paypalOrderId)
    .maybeSingle();
  if (payment?.amount_cents !== null && payment?.amount_cents !== undefined) {
    return moneyLabel(payment.amount_cents, payment.currency);
  }
  const cents =
    payment?.plan_price_cents ??
    (
      await admin
        .from("plans")
        .select("price_cents")
        .eq("id", planId)
        .maybeSingle()
    ).data?.price_cents ??
    null;
  return cents === null ? "—" : moneyLabel(cents, "USD");
}

// ── Phase 1: money ──────────────────────────────────────────

/** Personal purchase granted (grantPlanPurchase's `granted` branch — the
 * one point the capture route, the webhook and the reconcile repair share). */
export async function notifyPurchaseReceipt(
  admin: AdminClient,
  input: {
    userId: string;
    paypalOrderId: string;
    planId: string;
    planName: string;
    examId: string | null;
    periodEnd: string;
  }
): Promise<void> {
  const [examName, amountLabel] = await Promise.all([
    examNameFor(admin, input.examId),
    amountLabelFor(admin, input.paypalOrderId, input.planId),
  ]);
  await enqueueEmail(admin, {
    userId: input.userId,
    template: "purchase_receipt",
    dedupeKey: dedupeKey.receipt(input.paypalOrderId),
    payload: {
      planName: input.planName,
      examName,
      amountLabel,
      accessUntil: input.periodEnd,
      paypalOrderId: input.paypalOrderId,
    },
  });
}

/** Org purchase granted: the buyer plus every org admin. */
export async function notifyOrgPurchaseReceipt(
  admin: AdminClient,
  input: {
    orgId: string;
    buyerId: string;
    paypalOrderId: string;
    planId: string;
    planName: string;
    examId: string | null;
    periodEnd: string;
  }
): Promise<void> {
  const [orgName, examName, amountLabel, admins] = await Promise.all([
    orgNameFor(admin, input.orgId),
    examNameFor(admin, input.examId),
    amountLabelFor(admin, input.paypalOrderId, input.planId),
    orgAdminRecipients(admin, input.orgId),
  ]);
  const payload: EmailPayloads["org_purchase_receipt"] = {
    orgName,
    planName: input.planName,
    examName,
    amountLabel,
    accessUntil: input.periodEnd,
    paypalOrderId: input.paypalOrderId,
  };
  const recipients = [...new Set([input.buyerId, ...admins])];
  await enqueueEmails(
    admin,
    recipients.map((userId) => ({
      userId,
      template: "org_purchase_receipt" as const,
      dedupeKey: dedupeKey.orgReceipt(input.paypalOrderId, userId),
      payload,
    }))
  );
}

/** A refund landed (handleCaptureRefunded) and actually changed the total. */
export async function notifyRefundRecorded(
  admin: AdminClient,
  input: {
    userId: string;
    paypalOrderId: string;
    refundId: string;
    refundCents: number;
    totalRefundedCents: number;
    amountCents: number | null;
    currency: string | null;
    accessWithdrawn: boolean;
  }
): Promise<void> {
  await enqueueEmail(admin, {
    userId: input.userId,
    template: "refund_recorded",
    dedupeKey: dedupeKey.refund(input.refundId),
    payload: {
      refundLabel: moneyLabel(input.refundCents, input.currency),
      totalRefundedLabel: moneyLabel(input.totalRefundedCents, input.currency),
      amountLabel:
        input.amountCents === null ? "—" : moneyLabel(input.amountCents, input.currency),
      accessWithdrawn: input.accessWithdrawn,
      paypalOrderId: input.paypalOrderId,
    },
  });
}

/** A capture was denied or charged back (handleTerminalReversal). */
export async function notifyPaymentReversed(
  admin: AdminClient,
  input: {
    userId: string;
    paymentId: string;
    paypalOrderId: string;
    kind: "denied" | "reversed";
    amountCents: number | null;
    currency: string | null;
  }
): Promise<void> {
  await enqueueEmail(admin, {
    userId: input.userId,
    template: "payment_reversed",
    dedupeKey: dedupeKey.reversal(input.kind, input.paymentId),
    payload: {
      kind: input.kind,
      amountLabel:
        input.amountCents === null ? null : moneyLabel(input.amountCents, input.currency),
      paypalOrderId: input.paypalOrderId,
    },
  });
}

// ── Phase 3: org membership ─────────────────────────────────

/**
 * Invites addressed to EXISTING accounts. Brand-new addresses get the
 * Supabase auth invite instead (inviteMembers), so `ownerByEmail` — the
 * lookup the action already did — decides who lands here.
 */
export async function notifyOrgInvites(
  admin: AdminClient,
  input: {
    orgId: string;
    inviterId: string;
    invites: readonly { id: string; email: string; role: OrgMemberRole; expires_at: string }[];
    ownerByEmail: ReadonlyMap<string, string>;
  }
): Promise<void> {
  const targets = input.invites.flatMap((invite) => {
    const ownerId = input.ownerByEmail.get(invite.email.toLowerCase());
    return ownerId ? [{ invite, ownerId }] : [];
  });
  if (targets.length === 0) return;

  const [orgName, inviterName] = await Promise.all([
    orgNameFor(admin, input.orgId),
    displayNameFor(admin, input.inviterId, "An administrator"),
  ]);
  await enqueueEmails(
    admin,
    targets.map(({ invite, ownerId }) => ({
      userId: ownerId,
      template: "org_invite" as const,
      dedupeKey: dedupeKey.orgInvite(invite.id, invite.expires_at),
      payload: {
        orgName,
        inviterName,
        role: invite.role,
        acceptPath: `/org/join/${invite.id}`,
        expiresAt: invite.expires_at,
      },
    }))
  );
}

export async function notifyOrgMemberJoined(
  admin: AdminClient,
  input: { orgId: string; inviteId: string; memberId: string; role: OrgMemberRole }
): Promise<void> {
  const [orgName, memberName, admins] = await Promise.all([
    orgNameFor(admin, input.orgId),
    displayNameFor(admin, input.memberId, "A new member"),
    orgAdminRecipients(admin, input.orgId, input.memberId),
  ]);
  await enqueueEmails(
    admin,
    admins.map((adminId) => ({
      userId: adminId,
      template: "org_member_joined" as const,
      dedupeKey: dedupeKey.orgMemberJoined(input.inviteId, adminId),
      payload: { orgId: input.orgId, orgName, memberName, role: input.role },
    }))
  );
}

/** The removed member hears (transactional); the other admins get a notice. */
export async function notifyOrgMemberRemoved(
  admin: AdminClient,
  input: { orgId: string; userId: string; removedById: string }
): Promise<void> {
  const at = new Date().toISOString();
  const [orgName, memberName, removedByName, admins] = await Promise.all([
    orgNameFor(admin, input.orgId),
    displayNameFor(admin, input.userId, "A member"),
    displayNameFor(admin, input.removedById, "An administrator"),
    orgAdminRecipients(admin, input.orgId, input.removedById),
  ]);
  const rows: EnqueueInput[] = [
    {
      userId: input.userId,
      template: "org_member_removed",
      dedupeKey: dedupeKey.orgMemberRemoved(input.orgId, input.userId, at),
      payload: { orgName },
    },
    ...admins
      .filter((id) => id !== input.userId)
      .map((adminId) => ({
        userId: adminId,
        template: "org_member_removed_notice" as const,
        dedupeKey: dedupeKey.orgMemberRemovedNotice(
          input.orgId,
          input.userId,
          at,
          adminId
        ),
        payload: { orgId: input.orgId, orgName, memberName, removedByName },
      })),
  ];
  await enqueueEmails(admin, rows);
}

export async function notifyOrgRoleChanged(
  admin: AdminClient,
  input: { orgId: string; userId: string; role: OrgMemberRole }
): Promise<void> {
  const orgName = await orgNameFor(admin, input.orgId);
  await enqueueEmail(admin, {
    userId: input.userId,
    template: "org_role_changed",
    dedupeKey: dedupeKey.orgRoleChanged(
      input.orgId,
      input.userId,
      new Date().toISOString()
    ),
    payload: { orgName, role: input.role },
  });
}

// ── Phase 4: assignments (event side) ───────────────────────

export async function notifyAssignmentCreated(
  admin: AdminClient,
  assignment: OrgAssignment
): Promise<void> {
  const [orgName, audience] = await Promise.all([
    orgNameFor(admin, assignment.org_id),
    assignmentAudienceUserIds(assignment),
  ]);
  if (audience.length === 0) return;
  const payload: EmailPayloads["assignment_created"] = {
    orgName,
    title: assignment.title,
    dueAt: assignment.due_at,
    questionCount: assignment.config.num_questions,
    mode: assignment.config.mode ?? "exam",
  };
  await enqueueEmails(
    admin,
    audience.map((userId) => ({
      userId,
      template: "assignment_created" as const,
      dedupeKey: dedupeKey.assignmentCreated(assignment.id, userId),
      payload,
    }))
  );
}

// ── Phase 5: certificates and reports ───────────────────────

export async function notifyCertificateIssued(
  admin: AdminClient,
  input: { certificate: CourseCertificate; credentialName: string }
): Promise<void> {
  const c = input.certificate;
  await enqueueEmail(admin, {
    userId: c.user_id,
    template: "certificate_issued",
    dedupeKey: dedupeKey.certificate(c.id),
    payload: {
      courseTitle: c.course_title,
      credentialName: input.credentialName,
      issuedAt: c.issued_at,
      code: c.code,
      verifyPath: `/verify/${c.code}`,
      certificatesPath: "/cme/certificates",
    },
  });
}

/**
 * Reports just closed under one ruling (resolveOpenReports). One mail per
 * reporter however many of their reports closed; the lowest report id
 * anchors the key. Stems only — never the explanation or the key, which is
 * what a "fixed" ruling would otherwise be tempted to include.
 */
export async function notifyReportsResolved(
  admin: AdminClient,
  input: {
    rows: readonly { id: string; user_id: string; question_id: string }[];
    resolution: QuestionReportResolution;
  }
): Promise<void> {
  if (input.rows.length === 0) return;
  const questionIds = [...new Set(input.rows.map((r) => r.question_id))];
  const { data: questions } = await admin
    .from("questions")
    .select("id, stem")
    .in("id", questionIds);
  const stemById = new Map((questions ?? []).map((q) => [q.id, q.stem]));

  const rows: EnqueueInput[] = [];
  for (const [userId, reports] of groupByUser(input.rows)) {
    const ids = reports.map((r) => r.id).sort();
    const stems = [...new Set(reports.map((r) => r.question_id))]
      .slice(0, REPORT_STEM_CAP)
      .map((qid) => stemExcerpt(stemById.get(qid) ?? "(question)"));
    rows.push({
      userId,
      template: "report_resolved",
      dedupeKey: dedupeKey.reportResolved(userId, ids[0]),
      payload: { count: reports.length, resolution: input.resolution, stems },
    });
  }
  await enqueueEmails(admin, rows);
}

/**
 * A report was filed. Routed by whose bank the question is in: an org's
 * private bank tells that org's admins (they have inboxes, not a platform
 * queue); the public bank tells every platform admin, batched per question
 * — the dedupe key is the OLDEST open report on the question, so further
 * reports on it stay quiet until it is resolved.
 */
export async function notifyQuestionReported(
  admin: AdminClient,
  input: { reportId: string; questionId: string; category: string | null }
): Promise<void> {
  const { data } = await admin
    .from("questions")
    .select(
      "stem, subjects!inner(name, specialties!inner(exams!inner(name, org_id)))"
    )
    .eq("id", input.questionId)
    .maybeSingle();
  // Hand-maintained Database type carries no relationship metadata, so
  // embedded selects need the usual unknown hop.
  const row = data as unknown as {
    stem: string;
    subjects: {
      name: string;
      specialties: { exams: { name: string; org_id: string | null } };
    } | null;
  } | null;
  if (!row?.subjects) return;
  const exam = row.subjects.specialties.exams;
  const stem = stemExcerpt(row.stem);

  if (exam.org_id) {
    const [orgName, admins] = await Promise.all([
      orgNameFor(admin, exam.org_id),
      orgAdminRecipients(admin, exam.org_id),
    ]);
    const payload: EmailPayloads["org_question_reported"] = {
      orgId: exam.org_id,
      orgName,
      stem,
      category: input.category,
      reportsPath: "/org/content/reports",
    };
    await enqueueEmails(
      admin,
      admins.map((adminId) => ({
        userId: adminId,
        template: "org_question_reported" as const,
        dedupeKey: dedupeKey.orgQuestionReported(input.reportId, adminId),
        payload,
      }))
    );
    return;
  }

  // A count and the oldest id — never the rows: a much-reported question
  // must not cost a page of rows on the student's tap.
  const [admins, { count: openCount }, { data: oldest }] = await Promise.all([
    platformAdminRecipients(admin),
    admin
      .from("question_reports")
      .select("id", { count: "exact", head: true })
      .eq("question_id", input.questionId)
      .is("resolved_at", null),
    admin
      .from("question_reports")
      .select("id")
      .eq("question_id", input.questionId)
      .is("resolved_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (admins.length === 0) return;
  const anchor = oldest?.id ?? input.reportId;
  const payload: EmailPayloads["admin_question_reported"] = {
    stem,
    category: input.category,
    examName: exam.name,
    subjectName: row.subjects.name,
    openReports: Math.max(1, openCount ?? 0),
    reportsPath: "/admin/questions/reports",
  };
  await enqueueEmails(
    admin,
    admins.map((adminId) => ({
      userId: adminId,
      template: "admin_question_reported" as const,
      dedupeKey: dedupeKey.adminQuestionReported(anchor, adminId),
      payload,
    }))
  );
}

// ── Platform admins ─────────────────────────────────────────

const CONTACT_IMMEDIATE_PER_SENDER_24H = 3;
const CONTACT_IMMEDIATE_PER_HOUR = 20;

/** A contact-form submission (app/(marketing)/about/actions.ts). Immediate,
 * to every admin: these come from prospects, and a day's delay loses them. */
export async function notifyAdminContactMessage(
  admin: AdminClient,
  message: { id: string; name: string; email: string; subject: string; body: string }
): Promise<void> {
  // The contact form is the one session-less action in the app, and this
  // turns each accepted submission into N outbound emails. The ROW is kept
  // regardless (the daily digest counts it); only the immediate mail has a
  // lid — per sender, and across all senders for a script rotating
  // addresses — so a filled-in form cannot drive the outbox or the Resend
  // quota. Three per sender, not one: a real prospect follows up.
  const since24h = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const since1h = new Date(Date.now() - 3_600_000).toISOString();
  const [{ count: fromSender }, { count: lastHour }] = await Promise.all([
    admin
      .from("contact_messages")
      .select("id", { count: "exact", head: true })
      .eq("email", message.email)
      .gte("created_at", since24h),
    admin
      .from("contact_messages")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since1h),
  ]);
  if (
    (fromSender ?? 0) > CONTACT_IMMEDIATE_PER_SENDER_24H ||
    (lastHour ?? 0) > CONTACT_IMMEDIATE_PER_HOUR
  ) {
    return;
  }

  const admins = await platformAdminRecipients(admin);
  if (admins.length === 0) return;
  const payload: EmailPayloads["admin_contact_message"] = {
    messageId: message.id,
    name: message.name,
    email: message.email,
    subject: message.subject,
    excerpt: stemExcerpt(message.body, CONTACT_EXCERPT_CHARS),
    messagesPath: "/admin/messages",
  };
  await enqueueEmails(
    admin,
    admins.map((adminId) => ({
      userId: adminId,
      template: "admin_contact_message" as const,
      dedupeKey: dedupeKey.adminContact(message.id, adminId),
      payload,
    }))
  );
}

/** The bulk importer's commit finished (app/api/admin/questions-import/
 * commit). To the importer only — it is the result of their own action. */
export async function notifyAdminImportFinished(
  admin: AdminClient,
  input: {
    userId: string;
    examName: string;
    fileName: string;
    imported: number;
    skipped: number;
    errorRows: number;
    images: number;
    createdSpecialties: number;
    createdSubjects: number;
    questionsPath: string;
  }
): Promise<void> {
  const { userId, ...payload } = input;
  await enqueueEmail(admin, {
    userId,
    template: "admin_import_finished",
    dedupeKey: dedupeKey.adminImport(userId, new Date().toISOString()),
    payload,
  });
}

/**
 * A platform-admin role was granted or removed (app/admin/users/actions.ts).
 * Every CURRENT admin hears, the target included when they were just made
 * one — a second admin noticing an unexpected grant is the whole point.
 */
export async function notifyAdminRoleChanged(
  admin: AdminClient,
  input: { actorId: string; targetId: string; before: string; after: string }
): Promise<void> {
  const at = new Date().toISOString();
  const [admins, actorName, targetName, { data: targetEmail }] = await Promise.all([
    platformAdminRecipients(admin),
    displayNameFor(admin, input.actorId, "An administrator"),
    displayNameFor(admin, input.targetId, "A user"),
    admin.from("user_emails").select("email").eq("id", input.targetId).maybeSingle(),
  ]);
  const payload: EmailPayloads["admin_role_changed"] = {
    targetName,
    targetEmail: targetEmail?.email ?? null,
    before: input.before,
    after: input.after,
    actorName,
    usersPath: `/admin/users/${input.targetId}`,
  };
  await enqueueEmails(
    admin,
    admins.map((adminId) => ({
      userId: adminId,
      template: "admin_role_changed" as const,
      dedupeKey: dedupeKey.adminRoleChanged(input.targetId, at, adminId),
      payload,
    }))
  );
}

/** A product review landed in the pre-moderation queue (submitSiteReview).
 * Immediate, to every admin — nothing is public until someone rules. */
export async function notifyAdminReviewSubmitted(
  admin: AdminClient,
  review: {
    id: string;
    rating: number;
    displayName: string;
    examName: string | null;
    verifiedPurchase: boolean;
    body: string;
  }
): Promise<void> {
  const [admins, { count: pending }] = await Promise.all([
    platformAdminRecipients(admin),
    admin
      .from("site_reviews")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);
  if (admins.length === 0) return;
  const payload: EmailPayloads["admin_review_submitted"] = {
    reviewId: review.id,
    rating: review.rating,
    displayName: review.displayName,
    examName: review.examName,
    verifiedPurchase: review.verifiedPurchase,
    body: review.body,
    pendingReviews: Math.max(1, pending ?? 0),
    reviewsPath: "/admin/reviews",
  };
  await enqueueEmails(
    admin,
    admins.map((adminId) => ({
      userId: adminId,
      template: "admin_review_submitted" as const,
      dedupeKey: dedupeKey.adminReview(review.id, adminId),
      payload,
    }))
  );
}
