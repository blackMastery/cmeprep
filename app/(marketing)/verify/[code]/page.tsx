import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site";
import Link from "next/link";
import { BadgeCheck, SearchX } from "lucide-react";
import { getCertificateByCode } from "@/lib/certificates";
import { formatCertificateDate } from "@/lib/certificates-core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { VerifyForm } from "@/components/marketing/verify-form";

/**
 * Public certificate verification — no session, no captcha, no rate-limit
 * table.
 *
 * The protection is the code itself: 50 bits of randomness over an
 * unambiguous alphabet, and deliberately not the row id, so the keyspace
 * cannot be walked or ordered. Beyond that the page reveals only what is
 * already printed on the document the verifier is holding — holder, course,
 * date. Never the user id, the email, the course id or the course's size.
 *
 * Unknown, malformed and non-existent codes all produce the SAME response, so
 * the endpoint distinguishes nothing for anyone probing it.
 */
export const metadata: Metadata = {
  title: "Verify a certificate",
  description:
    `Check a ${SITE_NAME} CME certificate of completion by its certificate ID.`,
  // A verification result carries a person's name. It belongs to whoever was
  // handed the code, not to a search index.
  robots: { index: false, follow: false },
};

export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  // No decodeURIComponent: Next has already decoded the param, and a second
  // pass throws URIError on an input like /verify/100%25 — a 500 where this
  // page promises a uniform "not found" for anything malformed.
  const certificate = await getCertificateByCode(code);

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16">
      <header className="mb-6 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Certificate verification
        </h1>
      </header>

      {certificate ? (
        <Card className="border-primary/40">
          <CardContent className="space-y-5 py-8 text-center">
            <p className="flex items-center justify-center gap-2 font-medium text-primary">
              <BadgeCheck className="size-5" aria-hidden />
              Verified
            </p>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                This certificate was issued to
              </p>
              <p className="font-display text-2xl font-semibold">
                {certificate.name}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                for completing the CME course
              </p>
              <p className="text-lg">{certificate.courseTitle}</p>
            </div>
            <p className="text-sm">
              Completed on {formatCertificateDate(certificate.issuedAt)}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              {certificate.code}
            </p>
            <p className="border-t pt-4 text-xs text-muted-foreground">
              This certificate documents course completion and does not confer
              CME credit.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-5 py-8 text-center">
            <p className="flex items-center justify-center gap-2 font-medium">
              <SearchX className="size-5 text-muted-foreground" aria-hidden />
              No certificate found for that code
            </p>
            <p className="text-sm text-muted-foreground">
              Check the certificate ID as printed on the document — it looks
              like <span className="font-mono">CME-7K2M9-QX4PD</span>.
            </p>
            <VerifyForm />
          </CardContent>
        </Card>
      )}

      <p className="mt-8 text-center text-sm text-muted-foreground">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/">Back to cmeprep.me</Link>
        </Button>
      </p>
    </div>
  );
}
