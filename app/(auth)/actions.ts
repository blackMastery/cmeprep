"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  emailSchema,
  fullNameSchema,
  OAUTH_NEXT_COOKIE,
  oauthProviderSchema,
  passwordSchema,
  safeRedirectPath,
} from "@/lib/validation";

/**
 * Non-secret fields echoed back on failure.
 *
 * React 19 resets an uncontrolled `<form action={fn}>` as soon as the action
 * resolves — it cannot tell a returned error from a success — so anything the
 * user typed is wiped unless the state carries it back for `defaultValue`.
 * Passwords are deliberately absent: re-serving a secret so it can land in an
 * HTML attribute is not worth saving one retype.
 */
export type AuthValues = { email?: string; fullName?: string };

export type AuthState =
  | { error?: string; success?: string; values?: AuthValues }
  | null;

/** Raw submitted text, not the zod output — `emailSchema` lower-cases and
 *  trims, and rewriting what someone typed under them is its own surprise. */
function typed(formData: FormData, ...names: (keyof AuthValues)[]): AuthValues {
  const values: AuthValues = {};
  for (const name of names) {
    values[name] = String(formData.get(name) ?? "");
  }
  return values;
}

async function siteUrl() {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}

export async function login(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = z
    .object({ email: emailSchema, password: z.string().min(1, "Enter your password") })
    .safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0].message,
      values: typed(formData, "email"),
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Supabase returns this for unverified emails as well as bad credentials;
    // keep the message generic so we don't leak which accounts exist.
    return {
      error: "Incorrect email or password, or your email is not yet verified.",
      values: typed(formData, "email"),
    };
  }

  revalidatePath("/", "layout");
  redirect(safeRedirectPath(formData.get("next")));
}

export async function register(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = z
    .object({
      fullName: fullNameSchema,
      email: emailSchema,
      password: passwordSchema,
    })
    .safeParse({
      fullName: formData.get("fullName"),
      email: formData.get("email"),
      password: formData.get("password"),
    });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0].message,
      values: typed(formData, "email", "fullName"),
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${await siteUrl()}/auth/confirm`,
    },
  });

  if (error) {
    return { error: error.message, values: typed(formData, "email", "fullName") };
  }

  redirect(`/verify-email?email=${encodeURIComponent(parsed.data.email)}`);
}

export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0].message,
      values: typed(formData, "email"),
    };
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${await siteUrl()}/auth/confirm?next=/reset-password`,
  });

  // Always report success — never reveal whether an account exists.
  return {
    success:
      "If an account exists for that email, a reset link is on its way. Check your inbox.",
  };
}

export async function updatePassword(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = z
    .object({
      password: passwordSchema,
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, {
      message: "Passwords do not match",
      path: ["confirm"],
    })
    .safeParse({
      password: formData.get("password"),
      confirm: formData.get("confirm"),
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Your reset link has expired. Request a new one." };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) return { error: error.message };

  // From the profile page's Security card the user stays put; the email
  // reset flow (no `stay` field) keeps its original landing.
  if (formData.get("stay") === "1") {
    revalidatePath("/profile");
    return { success: "Password updated." };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * Start an OAuth sign-in from a plain form post.
 *
 * Runs server-side so the PKCE code-verifier cookie is written by the same
 * client that later exchanges the code in /auth/callback — @supabase/ssr
 * applies verifier cookies immediately rather than waiting for an auth event.
 * Errors round-trip via /login?error= (the callback route uses the same
 * channel), so no useActionState here.
 */
export async function signInWithProvider(formData: FormData): Promise<void> {
  const parsed = oauthProviderSchema.safeParse(formData.get("provider"));
  if (!parsed.success) redirect("/login");

  // The destination rides a cookie, not a ?next= on the callback URL — see
  // OAUTH_NEXT_COOKIE. Always set it so a stale value from an abandoned
  // attempt can't redirect this one.
  const next = safeRedirectPath(formData.get("next"));
  (await cookies()).set(OAUTH_NEXT_COOKIE, next, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 300,
    path: "/auth/callback",
  });

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: parsed.data,
    options: {
      redirectTo: `${await siteUrl()}/auth/callback`,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data?.url) {
    redirect(
      `/login?error=${encodeURIComponent(
        "Could not connect to the sign-in provider. Please try again."
      )}`
    );
  }
  redirect(data.url);
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
