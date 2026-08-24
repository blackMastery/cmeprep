"use client";

import {
  Bookmark,
  BookOpen,
  BookMarked,
  Building2,
  ClipboardList,
  FilePlus2,
  History,
  LayoutDashboard,
  ListTodo,
  MessagesSquare, // unused while the AI tutor nav link is commented out
  ShieldCheck,
  UserRound,
} from "lucide-react";
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
  { href: "/plan", label: "Study plan", icon: ListTodo },
  { href: "/resources", label: "Resources", icon: BookMarked },
  { href: "/tutor", label: "AI tutor", icon: MessagesSquare },
  { href: "/tests", label: "History", icon: History },
  { href: "/cme", label: "CME", icon: BookOpen },
  { href: "/bookmarks", label: "Bookmarks", icon: Bookmark },
  { href: "/profile", label: "Profile", icon: UserRound },
];

const ADMIN_ITEM: SideNavItem = {
  href: "/admin",
  label: "Admin",
  icon: ShieldCheck,
};

const ORG_ITEM: SideNavItem = {
  href: "/org",
  label: "Organisation",
  icon: Building2,
};

const ASSIGNMENTS_ITEM: SideNavItem = {
  href: "/assignments",
  label: "Assignments",
  icon: ClipboardList,
};

function itemsFor(
  role: SessionUser["profile"]["role"],
  orgAdmin: boolean,
  orgMember: boolean
) {
  const items = [...NAV_ITEMS];
  // Membership lives on org_members, not the profile — the (app) layout
  // looks it up and passes the flags down.
  if (orgMember) items.splice(2, 0, ASSIGNMENTS_ITEM);
  if (orgAdmin) items.push(ORG_ITEM);
  if (role === "admin") items.push(ADMIN_ITEM);
  return items;
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
export function AppSidebar({
  user,
  orgAdmin = false,
  orgMember = false,
}: {
  user: SessionUser;
  orgAdmin?: boolean;
  orgMember?: boolean;
}) {
  return (
    <Sidebar
      items={itemsFor(user.profile.role, orgAdmin, orgMember)}
      footer={<TrialMeter profile={user.profile} />}
    />
  );
}

/** Hamburger + sheet for narrow screens. */
export function MobileNav({
  user,
  orgAdmin = false,
  orgMember = false,
}: {
  user: SessionUser;
  orgAdmin?: boolean;
  orgMember?: boolean;
}) {
  return (
    <MobileNavSheet
      items={itemsFor(user.profile.role, orgAdmin, orgMember)}
      logoHref="/dashboard"
      footer={<TrialMeter profile={user.profile} />}
    />
  );
}
