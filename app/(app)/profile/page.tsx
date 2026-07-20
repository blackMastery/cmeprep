import type { Metadata } from "next";
import { Flame, Target, TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getLifetimeStats } from "@/lib/stats";
import { StatCard } from "@/components/dashboard/stat-card";
import { IdentityCard } from "@/components/profile/identity-card";
import { PlanCard } from "@/components/profile/plan-card";
import { ChangePasswordForm } from "@/components/profile/change-password-form";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await requireUser();
  const { stats, streak } = await getLifetimeStats(user.id);

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
          <ChangePasswordForm />
        </div>
        <div className="space-y-6">
          <PlanCard profile={user.profile} />
        </div>
      </div>
    </div>
  );
}
