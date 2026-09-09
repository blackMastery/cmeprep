import { NextResponse } from "next/server";
import { isNotificationCategory } from "@/lib/email-core";
import { unsubscribeByToken } from "@/lib/email";
import { absoluteUrl } from "@/lib/site";
import { uuid } from "@/lib/validation";

/**
 * The List-Unsubscribe target (RFC 8058 one-click).
 *
 * Mail clients POST here with `List-Unsubscribe=One-Click` when the reader
 * presses their client's own unsubscribe button; that is the one case where
 * acting without a confirmation page is correct, because the client sent it
 * on the reader's behalf. A GET (someone pasted the header URL) goes to the
 * confirmation page instead so link-following scanners cannot act.
 */
function parse(url: URL) {
  const token = uuid().safeParse(url.searchParams.get("token"));
  const category = url.searchParams.get("category");
  return {
    token: token.success ? token.data : null,
    category: isNotificationCategory(category) ? category : null,
  };
}

export async function POST(request: Request) {
  const { token, category } = parse(new URL(request.url));
  if (!token || !category) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const result = await unsubscribeByToken(token, category);
  if (!result.ok) return NextResponse.json({ error: "unknown" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function GET(request: Request) {
  const { token, category } = parse(new URL(request.url));
  if (!token || !category) {
    return NextResponse.redirect(absoluteUrl("/profile"));
  }
  return NextResponse.redirect(
    absoluteUrl(`/unsubscribe/${token}?category=${category}`)
  );
}
