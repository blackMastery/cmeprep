import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Award, Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listCertificates } from "@/lib/certificates";
import { formatCertificateDate } from "@/lib/certificates-core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "CME certificates" };

/**
 * Where a learner finds a certificate months later — the course page alone
 * would mean hunting through the catalog to remember which course it was.
 *
 * The static segment wins over /cme/[id]: Next matches static route segments
 * before dynamic ones, so this never reaches the course page as id.
 */
export default async function CertificatesPage() {
  const user = await requireUser();
  const certificates = await listCertificates(user.id);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2">
        <Link href="/cme">
          <ArrowLeft data-icon="inline-start" />
          All CME courses
        </Link>
      </Button>

      <header className="mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Certificates
        </h1>
        <p className="mt-1 text-muted-foreground">
          Certificates of completion for the CME courses you&apos;ve finished.
          Each one carries a code anyone can check.
        </p>
      </header>

      {certificates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Award className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              Finish a CME course and your certificate appears here.
            </p>
            <Button variant="outline" asChild>
              <Link href="/cme">Browse CME courses</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {certificates.map((certificate) => (
            <li key={certificate.id}>
              <Card className="[--card-spacing:--spacing(5)]">
                <CardContent className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    {/* The snapshotted title, not the live course row: a
                        certificate names the course as it was at issue. */}
                    <p className="font-display leading-snug font-medium">
                      {certificate.course_title}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Issued {formatCertificateDate(certificate.issued_at)} ·{" "}
                      <span className="font-mono text-xs">
                        {certificate.code}
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild>
                      {/* Plain anchor — the route replies with
                          Content-Disposition attachment. */}
                      <a href={`/api/cme/certificates/${certificate.id}`}>
                        <Download data-icon="inline-start" />
                        Download PDF
                      </a>
                    </Button>
                    <Button variant="ghost" asChild>
                      <Link href={`/verify/${certificate.code}`}>Verify</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Certificates document course completion and do not confer CME credit.
        The name printed comes from your{" "}
        <Link href="/profile" className="underline underline-offset-2">
          profile
        </Link>{" "}
        — correcting it there updates every certificate.
      </p>
    </div>
  );
}
