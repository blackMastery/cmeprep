import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const INVALID = "That link is invalid or has expired.";

/**
 * Landing point for Supabase auth emails (verification and password reset).
 *
 * Supabase uses two different hand-offs depending on the flow, and both reach
 * this route, so handle each:
 *   - PKCE      → `?code=...`        → exchangeCodeForSession
 *   - OTP/magic → `?token_hash=&type=` → verifyOtp
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const next = searchParams.get("next") ?? "/dashboard";
  const safeNext = next.startsWith("/") ? next : "/dashboard";

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return redirectToLogin(origin, INVALID);
    return NextResponse.redirect(`${origin}${safeNext}`);
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (error) return redirectToLogin(origin, INVALID);
    return NextResponse.redirect(`${origin}${safeNext}`);
  }

  return redirectToLogin(origin, INVALID);
}

function redirectToLogin(origin: string, message: string) {
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(message)}`
  );
}
