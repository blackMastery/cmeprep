import type { Metadata } from "next";
import Link from "next/link";
import { unsubscribeTokenKnown } from "@/lib/email";
import { CATEGORY_LABEL, isNotificationCategory } from "@/lib/email-core";
import { SITE_NAME } from "@/lib/site";
import { uuid } from "@/lib/validation";
import { Card, CardContent } from "@/components/ui/card";
import { UnsubscribeForm } from "@/components/notifications/unsubscribe-form";

export const metadata: Metadata = {
  title: "Email settings",
  robots: { index: false, follow: false },
};

/**
 * One-click unsubscribe landing (notifications-plan.md). Outside the (app)
 * group so it needs no session — the token is the credential — and it only
 * ever shows the category name, never the account behind the token.
 */
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const [{ token }, { category }] = await Promise.all([params, searchParams]);
  const parsedToken = uuid().safeParse(token);
  const validCategory = isNotificationCategory(category) ? category : null;

  // The lookup lives in lib/email.ts with the rest of the token rule, so
  // this session-less page never holds the service-role client itself.
  const known =
    parsedToken.success && validCategory
      ? await unsubscribeTokenKnown(parsedToken.data)
      : false;

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <p className="mb-6 font-display text-lg font-semibold">{SITE_NAME}</p>
      <Card>
        <CardContent className="space-y-4">
          {known && validCategory && parsedToken.success ? (
            <UnsubscribeForm
              token={parsedToken.data}
              category={validCategory}
              title={CATEGORY_LABEL[validCategory].title}
              description={CATEGORY_LABEL[validCategory].description}
            />
          ) : (
            <>
              <h1 className="font-display text-xl">This link is no longer valid</h1>
              <p className="text-sm text-muted-foreground">
                You can change every email setting from your profile.
              </p>
              <Link href="/profile" className="text-sm font-medium underline">
                Open your profile
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
