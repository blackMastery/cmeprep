import Link from "next/link";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Teams upsell for users with NO org membership (callers gate on that — a
 * member seeing "create your organisation" would be a dead end, since
 * accounts belong to one org). Quiet by design: it sits among the account
 * cards, not above the study content.
 */
export function OrgUpsellCard() {
  return (
    <Card>
      <CardHeader>
        <span className="mb-2 flex size-10 items-center justify-center rounded-xl bg-secondary text-primary">
          <Building2 className="size-5" aria-hidden="true" />
        </span>
        <CardTitle>Studying as a team?</CardTitle>
        <CardDescription>
          Give a whole cohort access for one flat price — $1,200/year per
          examination, up to 90 people, with shared analytics, assignments
          and a private question bank.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button size="sm" asChild>
          <Link href="/org/new">Create your organisation</Link>
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <Link href="/teams">Learn more</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
