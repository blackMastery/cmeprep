import { requireUser } from "@/lib/auth";
import { AppHeader } from "@/components/app/app-header";
import { AppChrome } from "@/components/app/app-chrome";

/**
 * Authoritative gate for the whole authenticated area. proxy.ts does a cheap
 * cookie check for fast redirects; this layout is where the session is
 * actually validated and the profile (role, banned) is loaded.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="flex min-h-svh flex-col">
      <AppChrome>
        <AppHeader user={user} />
      </AppChrome>
      <main className="flex-1">{children}</main>
    </div>
  );
}
