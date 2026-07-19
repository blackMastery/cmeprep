import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/supabase/types";

export type SessionUser = {
  id: string;
  email: string;
  profile: Profile;
};

/**
 * Authoritative auth check for Server Components and Route Handlers.
 * Uses getUser() (validates the JWT with Supabase) rather than getSession(),
 * and loads the profile so callers can gate on role / banned status.
 *
 * Returns null when unauthenticated — use requireUser() to redirect instead.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  return { id: user.id, email: user.email ?? "", profile };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.profile.banned_at) redirect("/banned");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.profile.role !== "admin") redirect("/dashboard");
  return user;
}

/** Trial users may take at most `trials_limit` tests. */
export function hasTrialsRemaining(profile: Profile): boolean {
  if (profile.role !== "trial") return true;
  return profile.trials_used < profile.trials_limit;
}
