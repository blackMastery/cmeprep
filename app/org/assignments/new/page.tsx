import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireOrgAdmin } from "@/lib/orgs";
import { loadAssignmentFormOptions } from "@/lib/org-assignment-options";
import { AssignmentForm } from "@/components/org/assignment-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "New assignment" };

/**
 * Creating an assignment, on its own page (the edit dialog on
 * /org/assignments handles changes to an existing one). The prescription is
 * a long form — exam, mode, difficulty, length, a subject table and an
 * audience — and a page gives it room, a URL to return to and the ordinary
 * back button. A successful create redirects to the list; the action owns
 * that, so nothing here needs to know.
 */
export default async function NewOrgAssignmentPage() {
  const session = await requireOrgAdmin();
  const { exams, members, departments } =
    await loadAssignmentFormOptions(session);

  return (
    // No width or padding of its own: the org layout already centres the
    // content column (max-w-6xl) and pads it, and a second wrapper narrowed
    // the subject table and doubled the vertical space.
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/org/assignments">
            <ArrowLeft data-icon="inline-start" />
            Assignments
          </Link>
        </Button>
        {/* h2: the org layout owns the page's h1 (the org name). */}
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          New assignment
        </h2>
      </div>

      <Card className="[--card-spacing:--spacing(6)]">
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Members get exactly this test — same subjects, length and format
            — with a due date. They can retake it; the latest submitted score
            is what your dashboard reports. Tutor-mode assignments are
            untimed with instant explanations, and count as done only once
            every question is answered.
          </p>
          {/* The exam list is entitlement-filtered, so an empty one means
              the org's plan lapsed rather than an empty question bank. The
              form says so itself, but with nothing to fill in there is no
              reason to render it at all. */}
          {exams.length === 0 ? (
            <div className="space-y-3 text-center">
              <h2 className="font-display text-lg">Nothing to assign yet</h2>
              <p className="text-sm text-muted-foreground">
                Your organisation needs an active plan for an examination
                before you can set work on it.
              </p>
              <Button asChild>
                <Link href="/org/billing">Open billing</Link>
              </Button>
            </div>
          ) : (
            <AssignmentForm
              exams={exams}
              members={members}
              departments={departments}
              editing={null}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
