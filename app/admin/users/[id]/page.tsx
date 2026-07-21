import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Flame, Target, TrendingUp } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getUserDetail } from "@/lib/admin/users";
import { listActivePlans, paidPlans } from "@/lib/plans";
import { ROLE_LABEL } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { UserAccessCard } from "@/components/admin/user-access-card";
import { UserSubscriptionCard } from "@/components/admin/user-subscription-card";

export const metadata: Metadata = { title: "User" };

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export default async function AdminUserDetailPage(
  props: PageProps<"/admin/users/[id]">
) {
  const { id } = await props.params;
  // The layout already gates /admin/*; this call is for isSelf.
  const actor = await requireAdmin();

  const [detail, activePlans] = await Promise.all([
    getUserDetail(id),
    listActivePlans(),
  ]);
  if (!detail) notFound();

  const presets = paidPlans(activePlans).map((p) => ({
    name: p.name,
    durationMonths: p.duration_months,
  }));
  const { profile, email, subscriptions, stats, streak, testsCount } = detail;
  const isSelf = actor.id === profile.id;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/users">
            <ArrowLeft data-icon="inline-start" />
            Users
          </Link>
        </Button>
      </div>

      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {profile.full_name ?? email ?? "User"}
          </h1>
          <Badge variant={profile.role === "trial" ? "secondary" : "default"}>
            {ROLE_LABEL[profile.role]}
          </Badge>
          {profile.banned_at && <Badge variant="destructive">Banned</Badge>}
          {isSelf && <Badge variant="outline">You</Badge>}
        </div>
        <p className="mt-1 text-sm break-all text-muted-foreground">
          {email ?? "no email"} · joined{" "}
          {dateFormatter.format(new Date(profile.created_at))}
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
              : "No attempts yet"
          }
        />
        <StatCard
          icon={Flame}
          label="Day streak"
          value={streak}
          hint={`${testsCount} test${testsCount === 1 ? "" : "s"} taken`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <UserAccessCard profile={profile} isSelf={isSelf} />
        <UserSubscriptionCard
          userId={profile.id}
          subscriptions={subscriptions}
          presets={presets}
        />
      </div>
    </div>
  );
}
