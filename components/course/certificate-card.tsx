import Link from "next/link";
import { Award, Download, UserPen } from "lucide-react";
import { formatCertificateDate } from "@/lib/certificates-core";
import type { CourseCertificate } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The reward surface on a finished course.
 *
 * `certificate` is null only when the learner reached 100% without ever
 * setting a certificate name — completions from before the feature existed,
 * or someone who dismissed the prompt. Rather than a dead end, the card sends
 * them to their profile; the certificate mints on their next visit here.
 */
export function CertificateCard({
  certificate,
}: {
  certificate: CourseCertificate | null;
}) {
  if (!certificate) {
    return (
      <Card className="mb-6 border-primary/30 bg-secondary/30 [--card-spacing:--spacing(5)]">
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium">
              <Award className="size-5 text-primary" aria-hidden />
              Course completed — nice work.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add the name for your certificate and it&apos;s yours.
            </p>
          </div>
          <Button asChild>
            <Link href="/profile">
              <UserPen data-icon="inline-start" />
              Add your name
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-6 border-primary/30 bg-secondary/30 [--card-spacing:--spacing(5)]">
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            <Award className="size-5 text-primary" aria-hidden />
            Certificate of completion
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Issued {formatCertificateDate(certificate.issued_at)} ·{" "}
            <span className="font-mono text-xs">{certificate.code}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild>
            {/* Plain anchor: the route replies with Content-Disposition
                attachment, so a client-side navigation would be wrong. */}
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
  );
}
