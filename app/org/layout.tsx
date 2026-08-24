import type { Metadata } from "next";
import Link from "next/link";
import { listOrgSubscriptions, requireOrgAdmin } from "@/lib/orgs";
import { orgExamAlerts, orgGraceEnd, orgSubscriptionState } from "@/lib/orgs-core";
import { SITE_NAME } from "@/lib/site";
import { orgLogoUrl } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { OrgHeader } from "@/components/org/org-header";
import { OrgSidebar } from "@/components/org/org-nav";
import { OrgAdminAccessBanner } from "@/components/org/org-access-banners";

export const metadata: Metadata = {
  title: { default: "Organisation", template: `%s · Organisation · ${SITE_NAME}` },
  // This tree is outside app/(app), so its noindex no longer covers /org.
  robots: { index: false, follow: false },
};

/**
 * Gate and shell for the org-ADMIN area. It lives at app/org, OUTSIDE the
 * learner (app) shell, so it gets its own header and sidebar the way /admin
 * does — one navigation instead of the learner rail plus a row of tabs. The
 * member-facing /org/new and /org/join/… pages deliberately stay under
 * app/(app)/org: they only need a session, not org-admin, and belong in the
 * learner shell.
 *
 * Server Actions are still guarded individually; this layout protects
 * renders, not mutations.
 */
export default async function OrgLayout({
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

  // Per-exam trouble the org-wide state can't see: exam A lapsing while
  // exam B keeps the org "active" (purchases are per exam).
  const alerts = orgExamAlerts(subs, now);
  const alertExamNames = new Map<string, string>();
  if (alerts.length > 0) {
    const { data: exams } = await createAdminClient()
      .from("exams")
      .select("id, name")
      .in(
        "id",
        alerts.map((a) => a.examId)
      );
    for (const exam of exams ?? []) alertExamNames.set(exam.id, exam.name);
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <OrgHeader
        user={session.user}
        org={{
          name: session.org.name,
          logoUrl: orgLogoUrl(session.org.logo_path),
        }}
      />
      <div className="flex flex-1">
        <OrgSidebar />
        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
            {/* The pages render no h1 of their own; this is the document heading. */}
            <header className="mb-6">
              <p className="text-sm text-muted-foreground">Organisation</p>
              <h1 className="font-display text-3xl font-semibold tracking-tight">
                {session.org.name}
              </h1>
            </header>

            <OrgAdminAccessBanner
              state={state}
              suspended={session.org.suspended_at !== null}
              everSubscribed={subs.length > 0}
              graceEndsAt={
                state === "grace" && latestActiveEnd
                  ? orgGraceEnd(latestActiveEnd).toISOString()
                  : null
              }
            />

            {/* Only while the org-wide banner is quiet — in grace/locked states it
                already owns the message. */}
            {state === "active" &&
              session.org.suspended_at === null &&
              alerts.map((alert) => (
                <div
                  key={alert.examId}
                  className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-sun/60 bg-sun/15 px-4 py-2.5 text-sm"
                >
                  <p className="min-w-0 flex-1">
                    {alert.state === "grace" ? (
                      <>
                        Your team&apos;s access to{" "}
                        <span className="font-semibold">
                          {alertExamNames.get(alert.examId) ?? "an examination"}
                        </span>{" "}
                        has lapsed — it ends for good on{" "}
                        {new Date(alert.endsAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "long",
                        })}
                        .
                      </>
                    ) : (
                      <>
                        Your team&apos;s access to{" "}
                        <span className="font-semibold">
                          {alertExamNames.get(alert.examId) ?? "an examination"}
                        </span>{" "}
                        ends on{" "}
                        {new Date(alert.endsAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "long",
                        })}
                        .
                      </>
                    )}
                  </p>
                  <Link
                    href="/org/billing"
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    Renew
                  </Link>
                </div>
              ))}

            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
