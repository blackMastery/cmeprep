"use client";

import { FilePlus2, LayoutDashboard, ShieldCheck } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { Progress } from "@/components/ui/progress";
import {
  MobileNavSheet,
  Sidebar,
  type SideNavItem,
} from "@/components/side-nav";

const NAV_ITEMS: readonly SideNavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tests/new", label: "New test", icon: FilePlus2 },
];

const ADMIN_ITEM: SideNavItem = {
  href: "/admin",
  label: "Admin",
  icon: ShieldCheck,
};

function itemsFor(role: SessionUser["profile"]["role"]) {
  return role === "admin" ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS;
}

/** Compact trials-remaining meter, shown to trial users only. */
function TrialMeter({ profile }: { profile: SessionUser["profile"] }) {
  if (profile.role !== "trial") return null;
  const { trials_used, trials_limit } = profile;

  return (
    <div className="border-t border-sidebar-border p-4">
      <p className="flex items-baseline justify-between text-xs font-medium">
        Trial tests
        <span className="tabular-nums text-muted-foreground">
          {trials_used}/{trials_limit}
        </span>
      </p>
      <Progress
        value={Math.min(100, (trials_used / Math.max(1, trials_limit)) * 100)}
        className="mt-2 h-1.5"
        aria-label={`${trials_used} of ${trials_limit} trial tests used`}
      />
    </div>
  );
}

/** Desktop rail for the authenticated learner area. */
export function AppSidebar({ user }: { user: SessionUser }) {
  return (
    <Sidebar
      items={itemsFor(user.profile.role)}
      footer={<TrialMeter profile={user.profile} />}
    />
  );
}

/** Hamburger + sheet for narrow screens. */
export function MobileNav({ user }: { user: SessionUser }) {
  return (
    <MobileNavSheet
      items={itemsFor(user.profile.role)}
      logoHref="/dashboard"
      footer={<TrialMeter profile={user.profile} />}
    />
  );
}
