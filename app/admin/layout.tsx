import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { AdminHeader } from "@/components/admin/admin-header";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin · cmeprep.me" },
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

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <AdminHeader user={user} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
