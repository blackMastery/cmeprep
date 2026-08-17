import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
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

  if (!profile) {
    const healed = await healMissingProfile(user);
    if (!healed) return null;
    return { id: user.id, email: user.email ?? "", profile: healed };
  }

  return { id: user.id, email: user.email ?? "", profile };
}

/**
 * Recreate a profile row for a valid session that has none.
 *
 * Normally the on_auth_user_created trigger guarantees the row, but a
 * manually deleted row (Studio, ad-hoc SQL) otherwise bricks the account:
 * requireUser() bounces to /login, proxy.ts sees the valid session and
 * bounces back — an infinite redirect loop the user cannot escape. Returning
 * null here would keep that loop, so heal instead. The name fallback chain
 * mirrors handle_new_user() in the migrations ('name' is where Google and
 * LinkedIn OIDC put the display name).
 */
async function healMissingProfile(user: User): Promise<Profile | null> {
  const meta = user.user_metadata;
  const fullName =
    typeof meta?.full_name === "string"
      ? meta.full_name
      : typeof meta?.name === "string"
        ? meta.name
        : null;

  // Admin client: profiles has no INSERT policy for authenticated users, and
  // granting one would let a caller choose their own role. The caller's
  // identity is already verified by getUser() above; everything else is
  // column defaults.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .upsert({ id: user.id, full_name: fullName }, { onConflict: "id" })
    .select()
    .single();

  if (error || !data) {
    console.error("profile self-heal failed", { userId: user.id, error });
    return null;
  }
  console.warn("recreated missing profile row", { userId: user.id });
  return data;
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
