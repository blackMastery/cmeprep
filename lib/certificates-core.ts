/**
 * Pure certificate rules — eligibility, the public code format, and the text
 * fitting the PDF renderer needs. The sibling lib/certificates.ts does the DB
 * work and lib/certificate-pdf.ts draws the page.
 *
 * A certificate asserts COMPLETION only. cmeprep is not an accredited
 * provider, so nothing here computes credit hours, study time or any other
 * claim the system cannot defend from its own data.
 */

/**
 * Crockford base32: no I, L, O or U. Ambiguous glyphs are the enemy here —
 * this code gets read off a printed page and typed into /verify by someone
 * who has never seen it before.
 */
export const CERT_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 10 symbols over a 32-char alphabet = 50 bits. Not enumerable. */
export const CERT_CODE_LENGTH = 10;

const CERT_CODE_PREFIX = "CME";

/**
 * Format random bytes as CME-XXXXX-XXXXX. Randomness is an argument rather
 * than read from crypto here so the format is testable without stubbing.
 *
 * 256 / 32 divides exactly, so the modulo carries no bias.
 */
export function formatCertificateCode(bytes: Uint8Array): string {
  if (bytes.length < CERT_CODE_LENGTH) {
    throw new Error(`Need at least ${CERT_CODE_LENGTH} bytes for a code`);
  }
  let out = "";
  for (let i = 0; i < CERT_CODE_LENGTH; i++) {
    out += CERT_CODE_ALPHABET[bytes[i] % CERT_CODE_ALPHABET.length];
  }
  return `${CERT_CODE_PREFIX}-${out.slice(0, 5)}-${out.slice(5)}`;
}

/**
 * Normalise anything a verifier might paste into the canonical stored form,
 * or null if it cannot be one. Handles lowercase, missing/extra hyphens,
 * surrounding whitespace and the Crockford confusables (I/L → 1, O → 0), so
 * a transcription slip reads as "verified" rather than "not found".
 *
 * Returns the canonical string, which is exactly what the `code` column
 * holds — callers can compare with a plain equality filter.
 */
export function parseCertificateCode(input: string): string | null {
  let body = input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");

  // Length-guarded: a generated code can itself begin with the letters C, M,
  // E (e.g. CME-CME12-34567), and an unguarded strip would eat them from a
  // bare-entered code and reject a perfectly valid certificate.
  if (
    body.length === CERT_CODE_PREFIX.length + CERT_CODE_LENGTH &&
    body.startsWith(CERT_CODE_PREFIX)
  ) {
    body = body.slice(CERT_CODE_PREFIX.length);
  }
  if (body.length !== CERT_CODE_LENGTH) return null;

  for (const ch of body) {
    if (!CERT_CODE_ALPHABET.includes(ch)) return null;
  }
  return `${CERT_CODE_PREFIX}-${body.slice(0, 5)}-${body.slice(5)}`;
}

// ── eligibility ─────────────────────────────────────────────

export type CertificateEligibilityInput = {
  totalLessons: number;
  completedLessons: number;
  /** Ids of the course's quiz lessons (non-deleted). */
  quizLessonIds: readonly string[];
  /** Lesson ids this learner has a PASSING quiz attempt for. */
  passedQuizLessonIds: ReadonlySet<string>;
};

export type CertificateEligibility =
  | { eligible: true }
  | { eligible: false; reason: string };

/**
 * The quiz check is redundant TODAY and deliberately kept: lib/courses.ts
 * completeContentLesson() rejects quiz lessons ("Quizzes are completed by
 * passing them") and submitCourseQuiz() writes the progress row only on a
 * pass, so "every lesson complete" already implies "every quiz passed". That
 * invariant lives in another module though, and a future admin tool or
 * backfill writing progress rows directly would mint unearned certificates
 * for a publicly verifiable credential. Stated here, it cannot be lost.
 */
export function certificateEligibility(
  input: CertificateEligibilityInput
): CertificateEligibility {
  if (input.totalLessons === 0) {
    return { eligible: false, reason: "This course has no lessons yet." };
  }
  if (input.completedLessons < input.totalLessons) {
    return { eligible: false, reason: "Finish every lesson first." };
  }
  const unpassed = input.quizLessonIds.filter(
    (id) => !input.passedQuizLessonIds.has(id)
  );
  if (unpassed.length > 0) {
    return { eligible: false, reason: "Pass every quiz in the course first." };
  }
  return { eligible: true };
}

// ── printable text ──────────────────────────────────────────

/**
 * The PDF standard-14 fonts encode WinAnsi (CP1252) and NOTHING else —
 * pdf-lib throws outright on anything outside it. Names are user input on an
 * international product, so "Dr. Łukasz Wójcik" would otherwise 500 the
 * download rather than render.
 *
 * LIMITATION: this transliterates rather than reproduces. Latin accents
 * (é, ü, ñ, ø, æ) are in WinAnsi and survive untouched; Ł becomes L; a name in
 * Cyrillic, Greek, Arabic or CJK reduces to nothing. Printing those requires
 * embedding a Unicode font, which this deliberately does not do (see
 * lib/certificate-pdf.ts). Callers must handle an empty result.
 */
const WIN_ANSI_EXTRAS = new Set(
  "\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178"
);

/** Latin letters with no canonical decomposition, so NFKD cannot reach them. */
const TRANSLITERATIONS: Record<string, string> = {
  "\u0141": "L", "\u0142": "l", "\u0110": "D", "\u0111": "d",
  "\u0126": "H", "\u0127": "h", "\u013f": "L", "\u0140": "l",
  "\u014a": "N", "\u014b": "n", "\u0166": "T", "\u0167": "t",
  "\u0131": "i", "\u017f": "s", "\u1e9e": "SS", "\u0218": "S",
  "\u0219": "s", "\u021a": "T", "\u021b": "t",
};

function isWinAnsi(char: string): boolean {
  const cp = char.codePointAt(0) ?? 0;
  if (cp >= 0x20 && cp <= 0x7e) return true;
  if (cp >= 0xa0 && cp <= 0xff) return true;
  return WIN_ANSI_EXTRAS.has(char);
}

export function toPrintableText(text: string): string {
  let out = "";
  for (const char of text) {
    if (isWinAnsi(char)) {
      out += char;
      continue;
    }
    // Strip the accent rather than the letter: "ā" → "a" beats dropping it.
    const stripped = char
      .normalize("NFKD")
      .split("")
      .filter((c) => isWinAnsi(c) && !/\p{M}/u.test(c))
      .join("");
    out += stripped || TRANSLITERATIONS[char] || "";
  }
  return out.replace(/\s+/g, " ").trim();
}

// ── presentation ────────────────────────────────────────────

/**
 * UTC on purpose: the completion instant must read the same on the PDF, the
 * certificates list and the public verify page, none of which share a
 * timezone with each other or with the learner.
 */
export function formatCertificateDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

export function certificateFilename(courseTitle: string, code: string): string {
  const slug =
    courseTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "course";
  return `cmeprep-certificate-${slug}-${code}.pdf`;
}

/**
 * Largest size in [minSize, maxSize] whose rendered width fits maxWidth.
 * `measure` is the font's width-at-size so this stays pure and testable.
 *
 * A long course title or a name with several post-nominals would otherwise
 * run off the page — pdf-lib clips nothing and wraps nothing.
 */
export function fitTextSize(
  measure: (size: number) => number,
  maxWidth: number,
  maxSize: number,
  minSize: number
): number {
  for (let size = maxSize; size > minSize; size -= 0.5) {
    if (measure(size) <= maxWidth) return size;
  }
  return minSize;
}

/**
 * Hard truncation for the pathological case — a "name" that is still too
 * wide at minSize. Ellipsis rather than silent overflow.
 */
export function truncateToWidth(
  text: string,
  measure: (text: string) => number,
  maxWidth: number
): string {
  if (measure(text) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && measure(`${out}…`) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}
