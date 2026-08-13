import Link from "next/link";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Existing accounts get no invite email in v1 — this banner IS their
 * delivery channel (SPEC §4). Matched to the signed-in email server-side;
 * shown only while the invite is live and the user is org-less.
 */
export function OrgInviteBanner({
  inviteId,
  orgName,
}: {
  inviteId: string;
  orgName: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-teal/40 bg-teal/10 px-4 py-3">
      <Building2 className="size-5 shrink-0 text-teal" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{orgName}</span> has invited you to
        study with them — full question-bank access included.
      </p>
      <Button size="sm" asChild>
        <Link href={`/org/join/${inviteId}`}>View invite</Link>
      </Button>
    </div>
  );
}
