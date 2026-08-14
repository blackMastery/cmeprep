import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getOrgMembership } from "@/lib/orgs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateOrgForm } from "@/components/org/create-org-form";

export const metadata: Metadata = { title: "Create your organisation" };

export default async function NewOrgPage() {
  const user = await requireUser();

  // One org per account: members go to their org (or their dashboard), they
  // don't found a second one.
  const membership = await getOrgMembership(user.id);
  if (membership) {
    redirect(
      membership.membership.role === "admin" ? "/org/members" : "/dashboard"
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:py-16">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-2xl">
            Create your organisation
          </CardTitle>
          <CardDescription>
            Set up a team account for your hospital, school or company.
            Creating it is free — you&apos;ll pick a plan next, then invite up
            to 90 people.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateOrgForm />
        </CardContent>
      </Card>
    </div>
  );
}
