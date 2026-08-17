import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { OAUTH_NEXT_COOKIE, safeRedirectPath } from "@/lib/validation";

const FAILED = "Could not complete sign-in. Please try again.";

/**
 * Landing point for OAuth sign-in (Google / LinkedIn), separate from
 * /auth/confirm: providers report aborts as `?error=` params that route
 * doesn't handle, and its "link has expired" copy is email-flow wording.
 *
 * The post-login destination arrives in OAUTH_NEXT_COOKIE (set by
 * signInWithProvider), not as a query param — see the constant's doc comment.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const safeNext = safeRedirectPath(
    request.cookies.get(OAUTH_NEXT_COOKIE)?.value
  );

  // Provider/user aborts come back as error params, not a code.
  if (searchParams.get("error")) {
    const message =
      searchParams.get("error") === "access_denied"
        ? "Sign-in was cancelled."
        : FAILED;
    return redirectToLogin(origin, message);
  }

  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return clearNext(NextResponse.redirect(`${origin}${safeNext}`));
  }

  return redirectToLogin(origin, FAILED);
}

function redirectToLogin(origin: string, message: string) {
  return clearNext(
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`)
  );
}

/** One-shot cookie: expire it on every exit so it can't steer a later visit. */
function clearNext(res: NextResponse) {
  res.cookies.set(OAUTH_NEXT_COOKIE, "", { maxAge: 0, path: "/auth/callback" });
  return res;
}
