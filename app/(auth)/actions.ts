"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { emailSchema, fullNameSchema, passwordSchema } from "@/lib/validation";

export type AuthState = { error?: string; success?: string } | null;

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
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Supabase returns this for unverified emails as well as bad credentials;
    // keep the message generic so we don't leak which accounts exist.
    return { error: "Incorrect email or password, or your email is not yet verified." };
  }

  revalidatePath("/", "layout");
  const next = String(formData.get("next") || "/dashboard");
  redirect(next.startsWith("/") ? next : "/dashboard");
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
    return { error: parsed.error.issues[0].message };
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
    return { error: error.message };
  }

  redirect(`/verify-email?email=${encodeURIComponent(parsed.data.email)}`);
}

export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
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

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
