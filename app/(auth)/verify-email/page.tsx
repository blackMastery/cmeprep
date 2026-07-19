import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { AuthCard } from "@/components/auth/auth-card";

export const metadata: Metadata = { title: "Verify your email" };

export default async function VerifyEmailPage(
  props: PageProps<"/verify-email">
) {
  const { email } = await props.searchParams;
  const address = typeof email === "string" ? email : null;

  return (
    <AuthCard
      title="Check your inbox"
      footer={
        <Link href="/login" className="font-medium text-primary hover:underline">
          Back to log in
        </Link>
      }
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-accent text-primary">
          <MailCheck className="size-7" aria-hidden="true" />
        </span>
        <p className="text-sm text-muted-foreground">
          We sent a verification link
          {address ? (
            <>
              {" "}
              to <span className="font-medium text-foreground">{address}</span>
            </>
          ) : null}
          . Click it to activate your account, then log in.
        </p>
        <p className="text-xs text-muted-foreground">
          Nothing yet? Check your spam folder — delivery can take a minute.
        </p>
      </div>
    </AuthCard>
  );
}
