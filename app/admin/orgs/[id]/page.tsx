import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrgDetailForAdmin } from "@/lib/admin/orgs";
import { priceLabel } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  OrgMembersCard,
  OrgSettingsCard,
  OrgSubscriptionsCard,
} from "@/components/admin/org-detail";

export const metadata: Metadata = { title: "Organisation" };

const STATE_LABEL = {
  active: "Active",
  grace: "Grace period",
  locked: "Inactive",
} as const;

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function AdminOrgDetailPage(
  props: PageProps<"/admin/orgs/[id]">
) {
  const { id } = await props.params;
  const detail = await getOrgDetailForAdmin(id);
  if (!detail) notFound();

  const { org, state } = detail;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:py-12">
      <header>
        <Link
          href="/admin/orgs"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Organisations
        </Link>
        <h1 className="mt-1 flex items-center gap-3 font-display text-3xl font-semibold tracking-tight">
          {org.name}
          <Badge variant={state === "active" ? "default" : "secondary"}>
            {STATE_LABEL[state]}
          </Badge>
        </h1>
      </header>

      <OrgSettingsCard
        org={{
          id: org.id,
          name: org.name,
          seatLimit: org.seat_limit,
          suspended: org.suspended_at !== null,
        }}
      />

      <OrgSubscriptionsCard
        org={{
          id: org.id,
          name: org.name,
          seatLimit: org.seat_limit,
          suspended: org.suspended_at !== null,
        }}
        subscriptions={detail.subscriptions.map((sub) => ({
          id: sub.id,
          plan: sub.plan,
          planId: sub.plan_id,
          examId: sub.exam_id,
          examName: sub.exam_id
            ? (detail.publicExams.find((e) => e.id === sub.exam_id)?.name ??
              "Unknown exam")
            : null,
          status: sub.status,
          currentPeriodEnd: sub.current_period_end,
          paypalOrderId: sub.paypal_order_id,
        }))}
        orgPlans={detail.orgPlans.map((plan) => ({
          id: plan.id,
          name: plan.name,
          seatLimit: plan.seat_limit,
        }))}
        publicExams={detail.publicExams}
      />

      <OrgMembersCard
        org={{
          id: org.id,
          name: org.name,
          seatLimit: org.seat_limit,
          suspended: org.suspended_at !== null,
        }}
        members={detail.members.map((row) => ({
          userId: row.member.user_id,
          name: row.profile?.full_name ?? null,
          email: row.email,
          role: row.member.role,
        }))}
        invites={detail.invites.map((invite) => ({
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expiresAt: invite.expires_at,
        }))}
      />

      {detail.payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {detail.payments.map((payment) => (
                <li
                  key={payment.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1"
                >
                  <span className="font-medium tabular-nums">
                    {payment.amount_cents !== null
                      ? priceLabel(payment.amount_cents)
                      : "—"}
                  </span>
                  <Badge
                    variant={
                      payment.status === "captured" ? "default" : "secondary"
                    }
                  >
                    {payment.status}
                  </Badge>
                  <span className="text-muted-foreground">
                    {shortDate(payment.captured_at)} · {payment.plan_name ?? "—"}{" "}
                    · {payment.paypal_order_id}
                  </span>
                  {payment.org_subscription_id === null && (
                    <Badge variant="destructive">no grant</Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
