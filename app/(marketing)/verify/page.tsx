import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site";
import { Card, CardContent } from "@/components/ui/card";
import { VerifyForm } from "@/components/marketing/verify-form";

/**
 * The landing point for someone typing a code off a printed certificate.
 * Noindex for the same reason as the result page: verification is for whoever
 * holds the code.
 */
export const metadata: Metadata = {
  title: "Verify a certificate",
  description:
    `Check a ${SITE_NAME} CME certificate of completion by its certificate ID.`,
  robots: { index: false, follow: false },
};

export default function VerifyIndexPage() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16">
      <header className="mb-6 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Verify a certificate
        </h1>
        <p className="mt-2 text-muted-foreground">
          Enter the certificate ID printed on a cmeprep.me certificate of
          completion.
        </p>
      </header>
      <Card>
        <CardContent className="py-8">
          <VerifyForm />
        </CardContent>
      </Card>
    </div>
  );
}
