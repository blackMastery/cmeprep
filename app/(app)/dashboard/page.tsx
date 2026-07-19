import type { Metadata } from "next";
import Link from "next/link";
import { Flame, Plus, Target, TrendingUp } from "lucide-react";
import { requireUser, hasTrialsRemaining } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { calculateStreak } from "@/lib/scoring";
import { firstName } from "@/lib/names";
import type { Test, TopicAccuracy, UserStats } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { WeakAreas } from "@/components/dashboard/weak-areas";
import { PastTests } from "@/components/dashboard/past-tests";
import { AccountPanel } from "@/components/dashboard/account-panel";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = await createClient();

  // Each of these is one query against a view or table; RLS scopes them
  // to this user automatically.
  const [{ data: stats }, { data: topics }, { data: tests }, { data: days }] =
    await Promise.all([
      supabase
        .from("user_stats")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("topic_accuracy")
        .select("*")
        .eq("user_id", user.id)
        .gte("attempts", 5)
        .order("accuracy_pct", { ascending: true })
        .limit(5),
      supabase
        .from("tests")
        .select("*")
        .eq("user_id", user.id)
        .order("started_at", { ascending: false })
        .limit(8),
      supabase
        .from("user_daily_activity")
        .select("day")
        .eq("user_id", user.id)
        .order("day", { ascending: false })
        .limit(400),
    ]);

  const userStats = (stats as UserStats | null) ?? null;
  const streak = calculateStreak(
    (days ?? []).map((d) => d.day as string),
    new Date().toISOString().slice(0, 10)
  );

  const greetingName = firstName(user.profile.full_name);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {greetingName ? `Welcome back, ${greetingName}` : "Welcome back"}
          </h1>
          <p className="mt-1 text-muted-foreground">
            Pick up where you left off, or start something new.
          </p>
        </div>
        {hasTrialsRemaining(user.profile) && (
          <Button size="lg" asChild>
            <Link href="/tests/new">
              <Plus data-icon="inline-start" />
              Start new test
            </Link>
          </Button>
        )}
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={Target}
          label="Questions attempted"
          value={userStats?.attempted ?? 0}
        />
        <StatCard
          icon={TrendingUp}
          label="Accuracy"
          value={
            userStats?.attempted ? `${Math.round(userStats.accuracy_pct)}%` : "—"
          }
          hint={
            userStats?.attempted
              ? `${userStats.correct} of ${userStats.attempted} correct`
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
          <PastTests tests={(tests ?? []) as Test[]} />
        </div>
        <div className="space-y-6">
          <WeakAreas topics={(topics ?? []) as TopicAccuracy[]} />
          <AccountPanel profile={user.profile} />
        </div>
      </div>
    </div>
  );
}
