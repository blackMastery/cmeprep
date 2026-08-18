import "server-only";

import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  certificateEligibility,
  CERT_CODE_LENGTH,
  formatCertificateCode,
  parseCertificateCode,
} from "@/lib/certificates-core";
import { getCourseTree } from "@/lib/courses";
import type { SessionUser } from "@/lib/auth";
import type { CourseCertificate } from "@/lib/supabase/types";

/**
 * Issuing and reading CME certificates of completion.
 *
 * Reads of a learner's own certificates go through the RLS client — the
 * course_certificates_select_own policy is the enforcement, so this module
 * never restates it. The admin client appears exactly twice: inserting (there
 * is no client insert policy, deliberately — eligibility is checked HERE) and
 * the public /verify lookup, which has no session to run RLS against.
 */

/** One retry is enough: a collision in 50 bits is not a thing that happens. */
const CODE_ATTEMPTS = 2;

function newCode(): string {
  return formatCertificateCode(randomBytes(CERT_CODE_LENGTH));
}

/**
 * Issue the certificate for a completed course, or return the one already
 * issued. Null means "not eligible (yet)" — never an exception: this runs off
 * the back of the learner's progress writes, and a certificate problem must
 * never surface as a failure to save their progress.
 *
 * Idempotent through `unique (user_id, course_id)`. That constraint is doing
 * real work: marking the final lesson complete and passing the final quiz are
 * separate write paths that both mint, and on a course whose last lesson is a
 * quiz they can race.
 */
export async function mintCertificate(
  user: SessionUser,
  courseId: string
): Promise<CourseCertificate | null> {
  const credentialName = user.profile.credential_name?.trim();
  // No name, no certificate — a credential with a blank holder is worse than
  // none, and the name is captured on the learner's FIRST progress write, so
  // this is only reachable for pre-existing completions. Those mint on the
  // next course-page visit, once the name exists.
  if (!credentialName) return null;

  const existing = await getCertificateForCourse(user.id, courseId);
  if (existing) return existing;

  const tree = await getCourseTree(courseId, user.id);
  if (!tree) return null;

  const lessons = tree.modules.flatMap((m) => m.lessons);
  const quizLessonIds = lessons.filter((l) => l.kind === "quiz").map((l) => l.id);

  const eligibility = certificateEligibility({
    totalLessons: tree.completion.totalLessons,
    completedLessons: tree.completion.completedLessons,
    quizLessonIds,
    passedQuizLessonIds: await passedQuizLessonIds(user.id, quizLessonIds),
  });
  if (!eligibility.eligible) return null;

  const admin = createAdminClient();
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const { data, error } = await admin
      .from("course_certificates")
      .insert({
        user_id: user.id,
        course_id: courseId,
        code: newCode(),
        // Snapshots: a later rename, unpublish or soft-delete must not alter
        // or retract what has already been issued.
        course_title: tree.course.title,
        lesson_count: tree.completion.totalLessons,
      })
      .select("*")
      .single();

    if (!error) return data;
    if (error.code !== "23505") return null;

    // Code collision — mint a new one. Any other unique violation is the
    // (user_id, course_id) guard, i.e. a concurrent mint won the race, and
    // that row is the answer.
    if (!error.message.includes("_code_key")) {
      return getCertificateForCourse(user.id, courseId);
    }
  }
  return null;
}

/**
 * mintCertificate that cannot throw. Every caller is on a path where a
 * certificate is a bonus and the surrounding work is not — the learner's
 * progress writes, and the course overview render. createAdminClient() throws
 * on a missing service key, which would otherwise 500 the course page for
 * everyone who has finished a course.
 */
export async function mintCertificateQuietly(
  user: SessionUser,
  courseId: string
): Promise<CourseCertificate | null> {
  try {
    return await mintCertificate(user, courseId);
  } catch (error) {
    console.error("certificate mint failed", { courseId, error });
    return null;
  }
}

/** Lesson ids with a PASSING attempt. Empty query is skipped, not sent. */
async function passedQuizLessonIds(
  userId: string,
  quizLessonIds: readonly string[]
): Promise<Set<string>> {
  if (quizLessonIds.length === 0) return new Set();
  const supabase = await createClient();
  const { data } = await supabase
    .from("course_quiz_attempts")
    .select("lesson_id")
    .eq("user_id", userId)
    .eq("passed", true)
    .in("lesson_id", [...quizLessonIds]);
  return new Set((data ?? []).map((row) => row.lesson_id));
}

// ── the holder's name ───────────────────────────────────────

/**
 * Set the name printed on this learner's certificates.
 *
 * RLS'd client on purpose, mirroring updateProfileName: the column-level
 * `grant update (credential_name)` in 20260823000001 plus profiles_update_own
 * is what limits this to one column on one row, and the DB (not this code) is
 * the enforcement.
 *
 * Corrections are self-serve and propagate to every certificate the learner
 * holds, codes unchanged — a misspelling on a credential is otherwise a
 * permanent support ticket. Nothing snapshots the name for that reason.
 */
export async function setCredentialName(
  userId: string,
  name: string
): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ credential_name: name })
    .eq("id", userId);
  return !error;
}

// ── learner reads ───────────────────────────────────────────

export async function getCertificateForCourse(
  userId: string,
  courseId: string
): Promise<CourseCertificate | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("course_certificates")
    .select("*")
    .eq("user_id", userId)
    .eq("course_id", courseId)
    .maybeSingle();
  return data ?? null;
}

export async function listCertificates(
  userId: string
): Promise<CourseCertificate[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("course_certificates")
    .select("*")
    .eq("user_id", userId)
    .order("issued_at", { ascending: false });
  return data ?? [];
}

export async function getCertificateForUser(
  id: string,
  userId: string
): Promise<CourseCertificate | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("course_certificates")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

// ── public verification ─────────────────────────────────────

export type VerifiedCertificate = {
  name: string;
  courseTitle: string;
  issuedAt: string;
  code: string;
};

/**
 * The ONLY thing the public verify page may learn. Returns the three facts
 * already printed on the document someone handed the verifier — never the
 * user id, the email, the course id, or how much of the course there was.
 *
 * The name is read live rather than from a snapshot so a learner correcting
 * a typo fixes every certificate at once, codes unchanged.
 */
export async function getCertificateByCode(
  input: string
): Promise<VerifiedCertificate | null> {
  const code = parseCertificateCode(input);
  if (!code) return null;

  const { data } = await createAdminClient()
    .from("course_certificates")
    .select("code, course_title, issued_at, profiles(credential_name)")
    .eq("code", code)
    .maybeSingle();
  if (!data) return null;

  // Hand-maintained Database type carries no relationship metadata, so
  // embedded selects need the usual unknown hop.
  const row = data as unknown as {
    code: string;
    course_title: string;
    issued_at: string;
    profiles: { credential_name: string | null } | null;
  };

  // Unreachable in practice — minting requires a name and the profile form
  // cannot clear one. Treated as unverifiable rather than rendering a
  // certificate with a blank holder.
  const name = row.profiles?.credential_name?.trim();
  if (!name) return null;

  return {
    name,
    courseTitle: row.course_title,
    issuedAt: row.issued_at,
    code: row.code,
  };
}
