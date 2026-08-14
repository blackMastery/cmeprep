import "server-only";

import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getCurrentUser, requireUser, type SessionUser } from "@/lib/auth";
import { getOrgMembership } from "@/lib/orgs";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * WHO may author question-bank content, and over WHICH slice of the taxonomy.
 *
 * Platform admins author everything (public catalog + every org's bank, for
 * QA/support). Org-admins author exactly their own org's exam trees (SPEC
 * §6). The question actions and import routes are shared between /admin and
 * /org/content, so authorization lives here ONCE instead of forking the
 * option-diff/publish-fence machinery per storefront.
 */

export type ContentScope =
  | { kind: "platform" }
  | { kind: "org"; orgId: string };

export type ContentAuthor = { user: SessionUser; scope: ContentScope };

/** null for platform actors — feeds audit()'s org column directly. */
export function scopeOrgId(scope: ContentScope): string | null {
  return scope.kind === "org" ? scope.orgId : null;
}

/** Where this author's question pages live. */
export function questionsBasePath(scope: ContentScope): string {
  return scope.kind === "platform" ? "/admin/questions" : "/org/content/questions";
}

/**
 * Page/action gate. Call as the FIRST statement, outside try/catch —
 * requireUser() throws NEXT_REDIRECT.
 */
export async function requireContentAuthor(): Promise<ContentAuthor> {
  const user = await requireUser();
  if (user.profile.role === "admin") {
    return { user, scope: { kind: "platform" } };
  }
  const ctx = await getOrgMembership(user.id);
  if (ctx?.membership.role === "admin") {
    return { user, scope: { kind: "org", orgId: ctx.org.id } };
  }
  redirect("/dashboard");
}

/** Route-handler gate: JSON 401/403, like requireAdminJson. */
export async function requireContentAuthorJson(): Promise<
  { author: ContentAuthor } | { response: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      response: NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      ),
    };
  }
  if (user.profile.banned_at) {
    return {
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  if (user.profile.role === "admin") {
    return { author: { user, scope: { kind: "platform" } } };
  }
  const ctx = await getOrgMembership(user.id);
  if (ctx?.membership.role === "admin") {
    return { author: { user, scope: { kind: "org", orgId: ctx.org.id } } };
  }
  return {
    response: NextResponse.json(
      { error: "Content access required" },
      { status: 403 }
    ),
  };
}

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Scope pins. Platform scope short-circuits true WITHOUT an existence check —
 * the callers' own reads and FKs already fail loudly on bad ids, exactly as
 * they did before scoping existed. Org scope must resolve the target UP the
 * taxonomy to its exam's org_id; anything else (missing row included) is
 * "not yours".
 */
export async function examInScope(
  admin: AdminClient,
  examId: string,
  scope: ContentScope
): Promise<boolean> {
  if (scope.kind === "platform") return true;
  const { data } = await admin
    .from("exams")
    .select("org_id")
    .eq("id", examId)
    .maybeSingle();
  return data?.org_id === scope.orgId;
}

export async function specialtyInScope(
  admin: AdminClient,
  specialtyId: string,
  scope: ContentScope
): Promise<boolean> {
  if (scope.kind === "platform") return true;
  const { data } = await admin
    .from("specialties")
    .select("exams!inner(org_id)")
    .eq("id", specialtyId)
    .maybeSingle();
  return (
    (data as { exams: { org_id: string | null } } | null)?.exams.org_id ===
    scope.orgId
  );
}

export async function subjectInScope(
  admin: AdminClient,
  subjectId: string,
  scope: ContentScope
): Promise<boolean> {
  if (scope.kind === "platform") return true;
  const { data } = await admin
    .from("subjects")
    .select("specialties!inner(exams!inner(org_id))")
    .eq("id", subjectId)
    .maybeSingle();
  return (
    (data as { specialties: { exams: { org_id: string | null } } } | null)
      ?.specialties.exams.org_id === scope.orgId
  );
}

export async function questionInScope(
  admin: AdminClient,
  questionId: string,
  scope: ContentScope
): Promise<boolean> {
  if (scope.kind === "platform") return true;
  const inScope = await questionsInScope(admin, [questionId], scope);
  return inScope.includes(questionId);
}

/** The subset of `ids` this scope may touch — bulk actions filter, not fail. */
export async function questionsInScope(
  admin: AdminClient,
  ids: string[],
  scope: ContentScope
): Promise<string[]> {
  if (scope.kind === "platform" || ids.length === 0) return ids;
  const { data } = await admin
    .from("questions")
    .select("id, subjects!inner(specialties!inner(exams!inner(org_id)))")
    .in("id", ids)
    .eq("subjects.specialties.exams.org_id", scope.orgId);
  return (data ?? []).map((r) => r.id);
}
