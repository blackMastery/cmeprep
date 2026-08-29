import type { Metadata } from "next";
import { Flame, Target, TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLifetimeStats } from "@/lib/stats";
import { listExamCatalog } from "@/lib/catalog";
import { getOrgDepartment, getOrgMembership } from "@/lib/orgs";
import { listEnabledLanguageCodes } from "@/lib/translations";
import type { Subscription } from "@/lib/supabase/types";
import { OrgUpsellCard } from "@/components/org/org-upsell-card";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatCard } from "@/components/dashboard/stat-card";
import { IdentityCard } from "@/components/profile/identity-card";
import { LanguageCard } from "@/components/profile/language-card";
import { PlanCard } from "@/components/profile/plan-card";
import { SubscriptionCard } from "@/components/profile/subscription-card";
import { ChangePasswordForm } from "@/components/profile/change-password-form";
import { ExpiryBanners } from "@/components/subscriptions/expiry-banners";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await requireUser();
  const supabase = await createClient();

  // RLS scopes the subscriptions read to this user; one query serves the
  // expiry banner, current status and history.
  const [{ stats, streak }, { data: subs }, catalog, membership, enabledLanguageCodes] =
    await Promise.all([
      getLifetimeStats(user.id),
      supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      listExamCatalog(),
      getOrgMembership(user.id),
      listEnabledLanguageCodes(),
    ]);
  const subscriptions = (subs ?? []) as Subscription[];
  const memberDepartment =
    membership && membership.membership.department_id
      ? await getOrgDepartment(
          membership.org.id,
          membership.membership.department_id
        )
      : null;
  const examNames = Object.fromEntries(
    catalog.map((exam) => [exam.id, exam.name])
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Profile
        </h1>
        <p className="mt-1 text-muted-foreground">
          Your account details, plan and lifetime progress.
        </p>
      </header>

      <ExpiryBanners subscriptions={subscriptions} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={Target}
          label="Questions attempted"
          value={stats?.attempted ?? 0}
        />
        <StatCard
          icon={TrendingUp}
          label="Accuracy"
          value={stats?.attempted ? `${Math.round(stats.accuracy_pct)}%` : "—"}
          hint={
            stats?.attempted
              ? `${stats.correct} of ${stats.attempted} correct`
              : "Take a test to see this"
          }
        />
        <StatCard
          icon={Flame}
          label="Day streak"
          value={streak}
          hint={streak > 0 ? "Keep it going" : "Answer a question today"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <IdentityCard profile={user.profile} email={user.email} />
          <LanguageCard
            profile={user.profile}
            enabledLanguageCodes={enabledLanguageCodes}
          />
          <ChangePasswordForm />
        </div>
        <div className="space-y-6">
          <PlanCard profile={user.profile} />
          <SubscriptionCard
            subscriptions={subscriptions}
            examNames={examNames}
          />
          {/* Read-only: departments are assigned by org admins. */}
          {membership && (
            <Card>
              <CardHeader>
                <CardTitle>Organisation</CardTitle>
                <CardDescription>
                  {memberDepartment
                    ? `${memberDepartment.name} · ${membership.org.name}`
                    : membership.org.name}
                </CardDescription>
              </CardHeader>
            </Card>
          )}
          {/* One org per account — only pitch founding one to the org-less. */}
          {!membership && <OrgUpsellCard />}
        </div>
      </div>
    </div>
  );
}
