import type { Metadata } from "next";
import { requireOrgAdmin } from "@/lib/orgs";
import { OrgSettingsForm } from "@/components/org/org-settings-form";

export const metadata: Metadata = { title: "Organisation settings" };

export default async function OrgSettingsPage() {
  const session = await requireOrgAdmin();

  return (
    <div className="max-w-2xl">
      <OrgSettingsForm
        name={session.org.name}
        passMarkPct={session.org.pass_mark_pct}
        inactivityDays={session.org.risk_inactivity_days}
        logoPath={session.org.logo_path}
      />
    </div>
  );
}
