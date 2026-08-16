import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { guyanaDayBounds } from "@/lib/analytics-core";
import type { Payment, PaymentStatus } from "@/lib/supabase/types";

export const PAYMENTS_PAGE_SIZE = 25;

export type PaymentListFilters = {
  /** Guyana civil day (YYYY-MM-DD) the capture landed on. */
  day?: string;
  examId?: string;
  status?: PaymentStatus;
  /** Money captured with no grant — the ops-alert drill-down. */
  unclaimed?: boolean;
  page?: number;
};

export type PaymentListRow = {
  payment: Payment;
  buyerName: string | null;
  buyerEmail: string | null;
  examName: string | null;
};

/**
 * The /admin/payments drill-down list. Every read is service-role — the
 * column-level grants on payments (plan_price_cents, custom_id, source,
 * grant_failure) make an RLS-client `select *` fail by design.
 */
export async function listPayments(filters: PaymentListFilters): Promise<{
  rows: PaymentListRow[];
  total: number;
  page: number;
  pageCount: number;
}> {
  const admin = createAdminClient();
  const page = Math.max(1, filters.page ?? 1);
  const from = (page - 1) * PAYMENTS_PAGE_SIZE;

  let query = admin
    .from("payments")
    .select("*", { count: "exact" })
    .order("captured_at", { ascending: false })
    .range(from, from + PAYMENTS_PAGE_SIZE - 1);

  if (filters.day !== undefined) {
    const { fromIso, toIso } = guyanaDayBounds(filters.day);
    query = query.gte("captured_at", fromIso).lt("captured_at", toIso);
  }
  if (filters.examId !== undefined) query = query.eq("exam_id", filters.examId);
  if (filters.status !== undefined) query = query.eq("status", filters.status);
  if (filters.unclaimed) {
    // Mirrors the reconcile sweep's definition exactly: no grant of either
    // kind, and the buyer is still owed (denied/reversed/refunded are not).
    query = query
      .is("subscription_id", null)
      .is("org_subscription_id", null)
      .in("status", ["captured", "partially_refunded"]);
  }

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const payments = (data ?? []) as Payment[];
  const total = count ?? 0;

  const userIds = [
    ...new Set(payments.map((p) => p.user_id).filter((v): v is string => v !== null)),
  ];
  const examIds = [
    ...new Set(payments.map((p) => p.exam_id).filter((v): v is string => v !== null)),
  ];

  const [profiles, emails, exams] = await Promise.all([
    userIds.length > 0
      ? admin.from("profiles").select("id, full_name").in("id", userIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    userIds.length > 0
      ? admin.from("user_emails").select("id, email").in("id", userIds)
      : Promise.resolve({ data: [] as { id: string; email: string | null }[] }),
    examIds.length > 0
      ? admin.from("exams").select("id, name").in("id", examIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const nameById = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name]));
  const emailById = new Map((emails.data ?? []).map((e) => [e.id, e.email]));
  const examById = new Map((exams.data ?? []).map((e) => [e.id, e.name]));

  return {
    rows: payments.map((payment) => ({
      payment,
      buyerName: payment.user_id ? (nameById.get(payment.user_id) ?? null) : null,
      buyerEmail: payment.user_id ? (emailById.get(payment.user_id) ?? null) : null,
      examName: payment.exam_id ? (examById.get(payment.exam_id) ?? null) : null,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAYMENTS_PAGE_SIZE)),
  };
}
