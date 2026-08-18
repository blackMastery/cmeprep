import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { certificateFilename } from "@/lib/certificates-core";
import { getCertificateForUser } from "@/lib/certificates";
import {
  renderCertificatePdf,
  UnprintableNameError,
} from "@/lib/certificate-pdf";

/**
 * GET /api/cme/certificates/[id] — the certificate PDF.
 *
 * Rendered per request from the immutable row rather than served from stored
 * bytes: the row already fixes every claim the document makes, so nothing can
 * drift, and the holder's name stays live so a correction reaches certificates
 * they downloaded months ago.
 *
 * getCurrentUser() rather than requireUser(): this is a route handler, and a
 * redirect to /login is not a useful response to a fetch for a PDF.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/cme/certificates/[id]">
) {
  const { id } = await ctx.params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // requireUser() bounces a banned account to /banned; a route handler has to
  // say it itself, and this one hands out a publicly verifiable document.
  if (user.profile.banned_at) {
    return NextResponse.json({ error: "Account suspended" }, { status: 403 });
  }

  // Scoped to the caller: a certificate id is not a capability, and one
  // learner must never be able to pull another's document.
  const certificate = await getCertificateForUser(id, user.id);
  if (!certificate) {
    return NextResponse.json({ error: "Certificate not found" }, { status: 404 });
  }

  const name = user.profile.credential_name?.trim();
  if (!name) {
    return NextResponse.json(
      { error: "Add your certificate name in your profile first." },
      { status: 409 }
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await renderCertificatePdf({
      name,
      courseTitle: certificate.course_title,
      issuedAt: certificate.issued_at,
      code: certificate.code,
    });
  } catch (error) {
    // A name the standard PDF fonts cannot represent at all — a real outcome
    // for a non-Latin script, and one worth saying plainly rather than
    // returning an opaque 500.
    if (error instanceof UnprintableNameError) {
      return NextResponse.json(
        {
          error:
            "Your certificate name uses characters we can't print yet. Set a Latin-script name in your profile, or contact support.",
        },
        { status: 422 }
      );
    }
    throw error;
  }

  // Buffer, not the raw Uint8Array: pdf-lib types its output over
  // ArrayBufferLike, which is not assignable to BodyInit.
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${certificateFilename(
        certificate.course_title,
        certificate.code
      )}"`,
      // The name is read live, so a cached copy could serve a stale one.
      "Cache-Control": "no-store",
    },
  });
}
