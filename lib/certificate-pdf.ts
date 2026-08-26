import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  fitTextSize,
  formatCertificateDate,
  toPrintableText,
  truncateToWidth,
} from "@/lib/certificates-core";
import { SITE_URL } from "@/lib/site";

/**
 * The certificate PDF: one A4 landscape page, drawn with pdf-lib.
 *
 * Typography is the PDF STANDARD 14 (Times + Helvetica) rather than the brand
 * Poppins, for the same reason lib/og-image.tsx uses the default face: the
 * brand fonts come from next/font/google and exist as no file in this repo, so
 * embedding them would mean either committing binaries or fetching at request
 * time — and a font fetch that fails silently yields a broken document. The
 * standard fonts need no file, no fontkit and cannot fail. Times is also the
 * conventional face for a certificate, so this costs nothing visually. The
 * brand shows up in the colours, which are the literal hex from globals.css
 * (CSS variables don't exist in this rendering context either).
 *
 * The cost of that choice is encoding: the standard-14 fonts cover WinAnsi
 * only and pdf-lib THROWS on anything else, so every string drawn here goes
 * through toPrintableText() first. See UnprintableNameError for the case that
 * leaves nothing to print.
 */

/**
 * The holder's name contains no WinAnsi-representable characters at all — a
 * name written entirely in Cyrillic, Greek, Arabic or CJK. Distinguished from
 * a generic failure so the download route can say something true and
 * actionable instead of returning a 500.
 */
export class UnprintableNameError extends Error {
  constructor() {
    super("Certificate name cannot be rendered with the standard fonts");
    this.name = "UnprintableNameError";
  }
}

const CREAM = hex("#faf6f1");
const CRIMSON = hex("#7a1429");
const INK = hex("#1a1a1a");
const INK_MUTED = hex("#6b6b6b");

/** A4 landscape, in points. */
const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
/** Text never crosses this — pdf-lib neither wraps nor clips. */
const CONTENT_WIDTH = 640;

function hex(value: string) {
  const n = parseInt(value.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Returns the drawn width, so callers can size a rule to match the text. */
function drawCentered(
  page: PDFPage,
  text: string,
  opts: { font: PDFFont; size: number; y: number; color: ReturnType<typeof rgb> }
): number {
  const width = opts.font.widthOfTextAtSize(text, opts.size);
  page.drawText(text, {
    x: (PAGE_WIDTH - width) / 2,
    y: opts.y,
    size: opts.size,
    font: opts.font,
    color: opts.color,
  });
  return width;
}

/** Centred hairline — the visual separator between certificate sections. */
function drawRule(page: PDFPage, y: number, width: number) {
  page.drawRectangle({
    x: (PAGE_WIDTH - width) / 2,
    y,
    width,
    height: 1,
    color: CRIMSON,
  });
}

/**
 * Fit-then-truncate: shrink to the smallest tasteful size, and only if it
 * STILL overflows (a name of post-nominals, a 140-character course title)
 * fall back to an ellipsis. Overflowing off the page is never an option.
 */
function drawFitted(
  page: PDFPage,
  text: string,
  opts: { font: PDFFont; maxSize: number; minSize: number; y: number; color: ReturnType<typeof rgb> }
): number {
  const size = fitTextSize(
    (s) => opts.font.widthOfTextAtSize(text, s),
    CONTENT_WIDTH,
    opts.maxSize,
    opts.minSize
  );
  const fitted = truncateToWidth(
    text,
    (t) => opts.font.widthOfTextAtSize(t, size),
    CONTENT_WIDTH
  );
  return drawCentered(page, fitted, {
    font: opts.font,
    size,
    y: opts.y,
    color: opts.color,
  });
}

export type CertificateRender = {
  /** profiles.credential_name — read live, never a snapshot. */
  name: string;
  courseTitle: string;
  issuedAt: string;
  code: string;
};

export async function renderCertificatePdf(
  input: CertificateRender
): Promise<Uint8Array> {
  // Every drawn string must be WinAnsi — pdf-lib throws otherwise.
  const name = toPrintableText(input.name);
  if (name === "") throw new UnprintableNameError();
  const courseTitle = toPrintableText(input.courseTitle);

  const pdf = await PDFDocument.create();

  // Standard-14: no fontkit, no file read, no network.
  const [times, timesBold, helvetica, helveticaBold] = await Promise.all([
    pdf.embedFont(StandardFonts.TimesRoman),
    pdf.embedFont(StandardFonts.TimesRomanBold),
    pdf.embedFont(StandardFonts.Helvetica),
    pdf.embedFont(StandardFonts.HelveticaBold),
  ]);

  pdf.setTitle(`Certificate of Completion — ${courseTitle}`);
  pdf.setAuthor("cmeqbank.com");
  pdf.setSubject("CME course certificate of completion");
  pdf.setCreator("cmeqbank.com");

  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    color: CREAM,
  });
  page.drawRectangle({
    x: 26,
    y: 26,
    width: PAGE_WIDTH - 52,
    height: PAGE_HEIGHT - 52,
    borderColor: CRIMSON,
    borderWidth: 2.5,
  });
  page.drawRectangle({
    x: 34,
    y: 34,
    width: PAGE_WIDTH - 68,
    height: PAGE_HEIGHT - 68,
    borderColor: CRIMSON,
    borderWidth: 0.75,
  });

  // Wordmark: bold "cmeqbank" + ".com" in crimson, the weight/colour contrast
  // the OG card uses.
  const markSize = 19;
  const markWidth =
    helveticaBold.widthOfTextAtSize("cmeqbank", markSize) +
    helvetica.widthOfTextAtSize(".com", markSize);
  const markX = (PAGE_WIDTH - markWidth) / 2;
  page.drawText("cmeqbank", {
    x: markX,
    y: 512,
    size: markSize,
    font: helveticaBold,
    color: INK,
  });
  page.drawText(".com", {
    x: markX + helveticaBold.widthOfTextAtSize("cmeqbank", markSize),
    y: 512,
    size: markSize,
    font: helvetica,
    color: CRIMSON,
  });

  // Standard-14 fonts carry no letter-spacing control, so the eyebrow is
  // spaced by hand.
  drawCentered(page, "C E R T I F I C A T E   O F   C O M P L E T I O N", {
    font: timesBold,
    size: 27,
    y: 452,
    color: CRIMSON,
  });
  drawRule(page, 432, 150);

  drawCentered(page, "This is to certify that", {
    font: helvetica,
    size: 13,
    y: 386,
    color: INK_MUTED,
  });

  const nameWidth = drawFitted(page, name, {
    font: timesBold,
    maxSize: 42,
    minSize: 20,
    y: 330,
    color: INK,
  });
  // Tracks the name rather than a fixed width — a rule visibly narrower than
  // the name it underlines reads as a layout bug.
  drawRule(page, 312, Math.min(CONTENT_WIDTH, nameWidth + 48));

  drawCentered(page, "has successfully completed the CME course", {
    font: helvetica,
    size: 13,
    y: 278,
    color: INK_MUTED,
  });

  drawFitted(page, courseTitle, {
    font: times,
    maxSize: 26,
    minSize: 14,
    y: 232,
    color: INK,
  });

  drawCentered(page, `Completed on ${formatCertificateDate(input.issuedAt)}`, {
    font: helvetica,
    size: 12,
    y: 190,
    color: INK,
  });

  drawRule(page, 152, 640);

  drawCentered(page, `Certificate ID   ${input.code}`, {
    font: helveticaBold,
    size: 11,
    y: 126,
    color: INK,
  });
  drawCentered(
    page,
    `Verify at ${SITE_URL.replace(/^https?:\/\//, "")}/verify/${input.code}`,
    { font: helvetica, size: 10, y: 108, color: INK_MUTED }
  );

  // Non-negotiable: cmeprep is not an accredited provider. The document must
  // never be mistakable for a credit claim.
  drawCentered(
    page,
    "This certificate documents course completion and does not confer CME credit.",
    { font: helvetica, size: 9, y: 64, color: INK_MUTED }
  );

  return pdf.save();
}
