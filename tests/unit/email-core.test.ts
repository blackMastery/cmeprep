import { describe, expect, it } from "vitest";
import {
  afterFailedAttempt,
  CATEGORY_LABEL,
  DEFAULT_PREFERENCES,
  dedupeKey,
  EMAIL_TEMPLATES,
  escapeHtml,
  expiryReminderStage,
  formatDateLong,
  groupByUser,
  isEmailTemplate,
  isNotificationCategory,
  isTransactional,
  MAX_SEND_ATTEMPTS,
  moneyLabel,
  NOTIFICATION_CATEGORIES,
  renderEmail,
  shouldDeliver,
  stemExcerpt,
  TEMPLATE_CATEGORY,
  adminDigestWorthSending,
  failureAlertDue,
  FAILURE_ALERT_THRESHOLD,
  TEMPLATE_AUDIENCE,
  type NotificationPrefs,
} from "@/lib/email-core";
import { dayStartUtc, guyanaDay } from "@/lib/orgs-core";

import { EMAIL_SAMPLES as SAMPLES } from "@/lib/email-samples";

const allOn: NotificationPrefs = {
  expiry_reminders: true,
  assignment_reminders: true,
  report_updates: true,
  weekly_digest: true,
  org_admin_events: true,
  org_assignment_summary: true,
  admin_operations: true,
};
const allOff: NotificationPrefs = {
  expiry_reminders: false,
  assignment_reminders: false,
  report_updates: false,
  weekly_digest: false,
  org_admin_events: false,
  org_assignment_summary: false,
  admin_operations: false,
};

describe("registry", () => {
  it("has a sample for every template and a category for every template", () => {
    for (const t of EMAIL_TEMPLATES) {
      expect(SAMPLES[t]).toBeDefined();
      expect(TEMPLATE_CATEGORY[t]).toBeDefined();
    }
    expect(Object.keys(SAMPLES).sort()).toEqual([...EMAIL_TEMPLATES].sort());
  });

  it("every org-admin template carries the org id its delivery check needs", () => {
    for (const t of EMAIL_TEMPLATES) {
      if (TEMPLATE_AUDIENCE[t] !== "org_admin") continue;
      expect((SAMPLES[t] as { orgId?: unknown }).orgId, t).toEqual(expect.any(String));
    }
    expect(TEMPLATE_AUDIENCE.admin_role_changed).toBe("platform_admin");
    expect(TEMPLATE_AUDIENCE.admin_import_finished).toBe("user");
  });

  it("every optional category is used by at least one template", () => {
    const used = new Set(Object.values(TEMPLATE_CATEGORY));
    for (const c of NOTIFICATION_CATEGORIES) expect(used.has(c)).toBe(true);
  });

  it("defaults match the migration: everything on except the digest", () => {
    expect(DEFAULT_PREFERENCES).toEqual({ ...allOn, weekly_digest: false });
  });

  it("guards recognise their own registries", () => {
    expect(isEmailTemplate("purchase_receipt")).toBe(true);
    expect(isEmailTemplate("marketing_blast")).toBe(false);
    expect(isNotificationCategory("weekly_digest")).toBe(true);
    expect(isNotificationCategory("transactional")).toBe(false);
    expect(isNotificationCategory(null)).toBe(false);
  });

  it("labels every category, with org ones marked", () => {
    for (const c of NOTIFICATION_CATEGORIES) expect(CATEGORY_LABEL[c].title).toBeTruthy();
    expect(CATEGORY_LABEL.org_admin_events.org).toBe(true);
    expect(CATEGORY_LABEL.expiry_reminders.org).toBe(false);
    expect(CATEGORY_LABEL.admin_operations.admin).toBe(true);
    expect(CATEGORY_LABEL.org_admin_events.admin).toBe(false);
  });
});

describe("shouldDeliver", () => {
  it("transactional templates ignore preferences entirely", () => {
    for (const t of EMAIL_TEMPLATES) {
      if (!isTransactional(t)) continue;
      expect(shouldDeliver(t, allOff)).toBe(true);
    }
    expect(isTransactional("purchase_receipt")).toBe(true);
    expect(isTransactional("org_invite")).toBe(true);
    expect(isTransactional("certificate_issued")).toBe(true);
    // Security-relevant and self-requested respectively: no toggle.
    expect(isTransactional("admin_role_changed")).toBe(true);
    expect(isTransactional("admin_import_finished")).toBe(true);
    expect(shouldDeliver("admin_contact_message", { ...allOn, admin_operations: false })).toBe(false);
    expect(shouldDeliver("admin_failure_alert", allOn)).toBe(true);
  });

  it("optional templates follow their category toggle", () => {
    expect(shouldDeliver("access_expiring", allOn)).toBe(true);
    expect(shouldDeliver("access_expiring", { ...allOn, expiry_reminders: false })).toBe(false);
    expect(shouldDeliver("weekly_digest", DEFAULT_PREFERENCES)).toBe(false);
    expect(shouldDeliver("assignment_summary", { ...allOn, org_assignment_summary: false })).toBe(false);
    expect(shouldDeliver("org_question_reported", { ...allOn, org_admin_events: false })).toBe(false);
  });
});

describe("renderEmail", () => {
  it("renders every template with subject, text and html", () => {
    for (const t of EMAIL_TEMPLATES) {
      const out = renderEmail(t, SAMPLES[t], { unsubscribeUrl: null });
      expect(out.subject.length, t).toBeGreaterThan(5);
      expect(out.text, t).toContain("cmeqbank.com");
      expect(out.html, t).toContain("<!doctype html>");
      expect(out.html, t).toContain("info@cmeqbank.com");
    }
  });

  it("escapes HTML in dynamic strings", () => {
    const out = renderEmail("org_invite", SAMPLES.org_invite, { unsubscribeUrl: null });
    expect(out.html).not.toContain("<b>Hibbert</b>");
    expect(out.html).toContain("&lt;b&gt;Hibbert&lt;/b&gt;");
    expect(out.text).toContain("Dr <b>Hibbert</b>");
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;"
    );
  });

  it("puts the unsubscribe link in both bodies only when given one", () => {
    const url = "https://www.cmeqbank.com/unsubscribe/t?category=expiry_reminders";
    const withLink = renderEmail("access_expiring", SAMPLES.access_expiring, {
      unsubscribeUrl: url,
    });
    expect(withLink.text).toContain(url);
    expect(withLink.html).toContain(url);
    const without = renderEmail("access_expiring", SAMPLES.access_expiring, {
      unsubscribeUrl: null,
    });
    expect(without.text).not.toContain("Turn off");
    expect(without.html).not.toContain("Turn off");
  });

  it("receipts carry the amount, the exam and the order id", () => {
    const out = renderEmail("purchase_receipt", SAMPLES.purchase_receipt, {
      unsubscribeUrl: null,
    });
    expect(out.subject).toContain("Annual");
    expect(out.text).toContain("$144.00 USD");
    expect(out.text).toContain("PLAB 1");
    expect(out.text).toContain("ORDER-1");
    const all = renderEmail(
      "purchase_receipt",
      { ...SAMPLES.purchase_receipt, examName: null },
      { unsubscribeUrl: null }
    );
    expect(all.text).toContain("every examination");
  });

  it("expiry copy distinguishes tomorrow from a week", () => {
    const week = renderEmail("access_expiring", SAMPLES.access_expiring, { unsubscribeUrl: null });
    expect(week.subject).toContain("7 days");
    const tomorrow = renderEmail(
      "access_expiring",
      { ...SAMPLES.access_expiring, daysLeft: 1 },
      { unsubscribeUrl: null }
    );
    expect(tomorrow.subject).toContain("tomorrow");
    expect(tomorrow.html).toContain("/checkout/plan-1?exam=exam-1");
  });

  it("refund copy says whether access changed", () => {
    const partial = renderEmail("refund_recorded", SAMPLES.refund_recorded, { unsubscribeUrl: null });
    expect(partial.text).toContain("unchanged");
    const full = renderEmail(
      "refund_recorded",
      { ...SAMPLES.refund_recorded, accessWithdrawn: true },
      { unsubscribeUrl: null }
    );
    expect(full.text).toContain("withdrawn");
  });

  it("summary lists who did not finish and the overflow count", () => {
    const out = renderEmail("assignment_summary", SAMPLES.assignment_summary, { unsubscribeUrl: null });
    expect(out.subject).toBe("Cardiology week 3: 9 of 12 completed");
    expect(out.text).toContain("Bart, Nelson and 1 more");
    expect(out.text).toContain("(2 late)");
    expect(out.text).toContain("71%");
  });

  it("report copy pluralises and names the resolution, never an answer", () => {
    const one = renderEmail(
      "report_resolved",
      { ...SAMPLES.report_resolved, count: 1, stems: ["Stem one"] },
      { unsubscribeUrl: null }
    );
    expect(one.subject).toBe("Your question report was reviewed");
    const many = renderEmail("report_resolved", SAMPLES.report_resolved, { unsubscribeUrl: null });
    expect(many.subject).toBe("2 of your question reports were reviewed");
    expect(many.text).toContain("corrected");
    const noChange = renderEmail(
      "report_resolved",
      { ...SAMPLES.report_resolved, resolution: "no_change" },
      { unsubscribeUrl: null }
    );
    expect(noChange.text).toContain("stands as written");
  });
});

describe("dedupe keys", () => {
  it("are stable and distinct per event", () => {
    expect(dedupeKey.receipt("O1")).toBe("receipt:O1");
    expect(dedupeKey.receipt("O1")).toBe(dedupeKey.receipt("O1"));
    expect(dedupeKey.orgReceipt("O1", "u1")).not.toBe(dedupeKey.orgReceipt("O1", "u2"));
    expect(dedupeKey.expiry("u1", null, "2026-09-16", 7)).toBe("expiry:u1:all:2026-09-16:7");
    expect(dedupeKey.expiry("u1", "e1", "2026-09-16", 7)).not.toBe(
      dedupeKey.expiry("u1", "e1", "2026-09-16", 1)
    );
    // A renewal moves the period end, which re-arms the key.
    expect(dedupeKey.expiry("u1", "e1", "2026-09-16", 7)).not.toBe(
      dedupeKey.expiry("u1", "e1", "2027-09-16", 7)
    );
    expect(dedupeKey.orgInvite("i1", "a")).not.toBe(dedupeKey.orgInvite("i1", "b"));
    expect(dedupeKey.reportResolved("u1", "r1")).toBe("report_resolved:u1:r1");
    expect(dedupeKey.digest("u1", "2026-08-31")).toBe("digest:u1:2026-08-31");
  });
});

describe("scan rules", () => {
  it("expiryReminderStage: exact for tomorrow, a window for the week", () => {
    expect(expiryReminderStage(0)).toBeNull();
    expect(expiryReminderStage(1)).toBe(1);
    expect(expiryReminderStage(2)).toBe(7);
    expect(expiryReminderStage(7)).toBe(7);
    expect(expiryReminderStage(8)).toBeNull();
    expect(expiryReminderStage(-1)).toBeNull();
  });

  it("groupByUser keeps order within a user", () => {
    const rows = [
      { id: "r1", user_id: "a" },
      { id: "r2", user_id: "b" },
      { id: "r3", user_id: "a" },
    ];
    const grouped = groupByUser(rows);
    expect([...grouped.keys()]).toEqual(["a", "b"]);
    expect(grouped.get("a")?.map((r) => r.id)).toEqual(["r1", "r3"]);
  });

  it("stemExcerpt flattens whitespace and caps with an ellipsis", () => {
    expect(stemExcerpt("  A   short\nstem  ")).toBe("A short stem");
    const long = "x".repeat(200);
    const out = stemExcerpt(long, 50);
    expect(out.length).toBe(50);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("admin scan rules", () => {
  it("digest is silent on an empty day and speaks while a queue is waiting", () => {
    const empty = { newMessages: 0, openMessages: 0, newReports: 0, openReportQuestions: 0, pendingReviews: 0 };
    expect(adminDigestWorthSending(empty)).toBe(false);
    expect(adminDigestWorthSending({ ...empty, pendingReviews: 1 })).toBe(true);
    expect(adminDigestWorthSending({ ...empty, newMessages: 2 })).toBe(true);
  });

  it("failure alerts fire at the threshold, not below", () => {
    expect(failureAlertDue(FAILURE_ALERT_THRESHOLD - 1)).toBe(false);
    expect(failureAlertDue(FAILURE_ALERT_THRESHOLD)).toBe(true);
  });

  it("admin copy names the queues and the role change", () => {
    const digest = renderEmail("admin_daily_digest", SAMPLES.admin_daily_digest, { unsubscribeUrl: null });
    expect(digest.text).toContain("2 new, 3 waiting");
    expect(digest.text).toContain("1 pending moderation");
    const role = renderEmail("admin_role_changed", SAMPLES.admin_role_changed, { unsubscribeUrl: null });
    expect(role.subject).toBe("Admin access granted to Lisa Simpson");
    const removed = renderEmail(
      "admin_role_changed",
      { ...SAMPLES.admin_role_changed, before: "admin", after: "student" },
      { unsubscribeUrl: null }
    );
    expect(removed.subject).toBe("Admin access removed from Lisa Simpson");
    const reported = renderEmail("admin_question_reported", SAMPLES.admin_question_reported, { unsubscribeUrl: null });
    expect(reported.subject).toBe("3 reports on a PLAB 1 question");
    expect(reported.text).toContain("wrong key");
    expect(reported.text).not.toContain("explanation");
    const single = renderEmail(
      "admin_question_reported",
      { ...SAMPLES.admin_question_reported, openReports: 1 },
      { unsubscribeUrl: null }
    );
    expect(single.subject).toBe("A PLAB 1 question was reported");
    expect(dedupeKey.adminQuestionReported("r1", "a1")).toBe("admin_report:r1:a1");
    const review = renderEmail("admin_review_submitted", SAMPLES.admin_review_submitted, { unsubscribeUrl: null });
    expect(review.subject).toBe("New 5-star review from Lisa S. awaiting moderation");
    expect(review.text).toContain("★★★★★");
    expect(review.text).toContain("verified purchase");
    expect(review.text).toContain("2 reviews are waiting");
    const alert = renderEmail("admin_failure_alert", SAMPLES.admin_failure_alert, { unsubscribeUrl: null });
    expect(alert.subject).toBe("OSCE grading: 7 failed calls in 24h");
    expect(alert.html).toContain("/admin/osce");
  });
});

describe("delivery arithmetic", () => {
  it("backs off then parks at the cap", () => {
    const now = new Date("2026-09-09T12:00:00Z");
    const first = afterFailedAttempt(1, now);
    expect(first.status).toBe("queued");
    expect(first.scheduledFor).toBe("2026-09-09T12:15:00.000Z");
    const second = afterFailedAttempt(2, now);
    expect(second.scheduledFor).toBe("2026-09-09T12:30:00.000Z");
    expect(afterFailedAttempt(MAX_SEND_ATTEMPTS, now).status).toBe("failed");
  });
});

describe("formatting", () => {
  it("moneyLabel carries the currency and two decimals", () => {
    expect(moneyLabel(14400, "USD")).toBe("$144.00 USD");
    expect(moneyLabel(1950, "USD")).toBe("$19.50 USD");
    expect(moneyLabel(14400, null)).toBe("$144");
  });

  it("dayStartUtc is the inverse of guyanaDay", () => {
    const start = dayStartUtc("2026-09-09");
    expect(guyanaDay(new Date(start))).toBe("2026-09-09");
    expect(guyanaDay(new Date(new Date(start).getTime() - 1))).toBe("2026-09-08");
  });

  it("formatDateLong renders in the site timezone", () => {
    // 03:30 UTC on the 10th is still the 9th in America/Guyana (UTC-4).
    expect(formatDateLong("2026-09-10T03:30:00Z")).toBe("9 September 2026");
  });
});
