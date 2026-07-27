import type { Metadata } from "next";
import Link from "next/link";
import { OG_IMAGE } from "@/lib/site";
import { AuthCard } from "@/components/auth/auth-card";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = {
  title: "Create your account",
  description:
    "Create a free cmeprep.me account and start with 10 questions and 2 practice tests — no card required.",
  alternates: { canonical: "/register" },
  // images repeated because a page-level openGraph replaces the root's — see
  // lib/site.ts.
  openGraph: {
    url: "/register",
    title: "Create your account · cmeprep.me",
    images: [OG_IMAGE],
  },
};

export default function RegisterPage() {
  return (
    <AuthCard
      title="Create your account"
      description="Start with 10 free questions and 2 practice tests."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthCard>
  );
}
