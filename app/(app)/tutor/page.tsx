import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getExamAccess } from "@/lib/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";
import { getConversation, getTutorUsage, tutorApiUrl } from "@/lib/tutor";
import { tutorAccessFor } from "@/lib/tutor-core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TutorChat } from "@/components/tutor/tutor-chat";

export const metadata: Metadata = { title: "AI tutor" };

/** History and usage are per-request state — never serve a cached transcript. */
export const dynamic = "force-dynamic";

export default async function TutorPage() {
  const user = await requireUser();

  // chat_messages and tutor_threads are deny-all for `authenticated` (the
  // tutor service writes them over a direct Postgres connection), so reads go
  // through the service-role client, scoped to this user by hand.
  const admin = createAdminClient();
  const [access, usage, turns] = await Promise.all([
    getExamAccess(user),
    getTutorUsage(admin, user.id),
    getConversation(admin, user.id),
  ]);

  const verdict = tutorAccessFor(user.profile.role, access, usage);

  if (!verdict.allowed) {
    // TrialLimitCard is deliberately not reused here: its copy counts free
    // TESTS, and the tutor allowance is a separate budget. The message from
    // tutorAccessFor already says which limit was hit.
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12">
        <LockedCard message={verdict.message} />
      </div>
    );
  }

  if (!tutorApiUrl()) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12">
        <LockedCard
          message="The AI tutor isn't switched on yet. Check back shortly."
          showPlans={false}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <TutorChat
        initialTurns={turns}
        remaining={verdict.remaining}
        limit={verdict.limit}
      />
    </div>
  );
}

function LockedCard({
  message,
  showPlans = true,
}: {
  message: string;
  /** Off for the service-unconfigured state: a plan won't unlock it. */
  showPlans?: boolean;
}) {
  return (
    <Card className="[--card-spacing:--spacing(7)]">
      <CardContent className="space-y-5 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-accent text-primary">
          <Lock className="size-6" aria-hidden="true" />
        </span>
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            AI tutor
          </h1>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            {message}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          {showPlans && (
            <Button size="lg" asChild>
              <Link href="/#pricing">View plans</Link>
            </Button>
          )}
          <Button size="lg" variant="outline" asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
