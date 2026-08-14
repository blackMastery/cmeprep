import { listOrgSubscriptions, requireOrgAdmin } from "@/lib/orgs";
import { orgGraceEnd, orgSubscriptionState } from "@/lib/orgs-core";
import { OrgNav } from "@/components/org/org-nav";
import { OrgAdminAccessBanner } from "@/components/org/org-access-banners";

/**
 * Gate for the org-ADMIN area. Sits in the (manage) route group so the
 * member-facing /org/join/… accept page is NOT behind it — that page only
 * needs a session. Server Actions are still guarded individually; this
 * layout protects renders, not mutations.
 */
export default async function OrgManageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireOrgAdmin();
  const now = new Date();

  const subs = await listOrgSubscriptions(session.org.id);
  const state = orgSubscriptionState(subs, now);
  const latestActiveEnd = subs
    .filter((s) => s.status === "active")
    .map((s) => s.current_period_end)
    .sort()
    .at(-1);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <p className="text-sm text-muted-foreground">Organisation</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {session.org.name}
        </h1>
      </header>

      <OrgAdminAccessBanner
        state={state}
        suspended={session.org.suspended_at !== null}
        graceEndsAt={
          state === "grace" && latestActiveEnd
            ? orgGraceEnd(latestActiveEnd).toISOString()
            : null
        }
      />

      <OrgNav />
      <div className="mt-6">{children}</div>
    </div>
  );
}
