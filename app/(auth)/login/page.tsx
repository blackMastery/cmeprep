import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const { next, error } = await props.searchParams;

  return (
    <AuthCard
      title="Welcome back"
      description="Log in to continue your exam preparation."
      footer={
        <>
          New to CME Prep?{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm
        next={typeof next === "string" ? next : undefined}
        initialError={typeof error === "string" ? error : undefined}
      />
    </AuthCard>
  );
}
