import Link from "next/link";
import { listOrgSubscriptions, requireOrgAdmin } from "@/lib/orgs";
import { orgExamAlerts, orgGraceEnd, orgSubscriptionState } from "@/lib/orgs-core";
import { createAdminClient } from "@/lib/supabase/admin";
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

      <OrgNav />
      <div className="mt-6">{children}</div>
    </div>
  );
}
