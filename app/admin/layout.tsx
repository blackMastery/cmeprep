import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { SITE_NAME } from "@/lib/site";
import { opsAlertCounts } from "@/lib/analytics";
import { openReportQuestionCount } from "@/lib/admin/question-reports";
import { AdminHeader } from "@/components/admin/admin-header";
import { AdminSidebar } from "@/components/admin/admin-nav";

export const metadata: Metadata = {
  title: { default: "Admin", template: `%s · Admin · ${SITE_NAME}` },
  robots: { index: false, follow: false },
};

/**
 * Authoritative gate for the admin area.
 *
 * `proxy.ts` already bounces unauthenticated requests to /login, but it does
 * no role check by design (it runs on every prefetch). This layout is where
 * `role !== "admin"` is actually caught.
 *
 * IMPORTANT: a layout does NOT gate Server Actions — an action POST runs its
 * mutation first and the layout only renders afterwards during revalidation.
 * Every admin Server Action calls requireAdmin() itself, as its first line.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();

  // Two indexed head-counts per admin page load (payments_unclaimed_idx,
  // payment_events_unprocessed_idx) — cheap enough to skip caching. Known
  // limitation: layouts don't re-render on soft navigation, so the badge
  // refreshes on hard loads and section changes, not every click.
  const [alerts, openReports] = await Promise.all([
    opsAlertCounts(),
    openReportQuestionCount({ kind: "platform" }),
  ]);
  const badges = {
    payments: alerts.unclaimed + alerts.backlog,
    questions: openReports,
  };

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <AdminHeader user={user} badges={badges} />
      <div className="flex flex-1">
        <AdminSidebar badges={badges} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
