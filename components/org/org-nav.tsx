"use client";

import {
  ClipboardList,
  CreditCard,
  History,
  LayoutDashboard,
  ListChecks,
  Settings,
  Users,
} from "lucide-react";
import {
  MobileNavSheet,
  Sidebar,
  type SideNavItem,
} from "@/components/side-nav";

/**
 * Navigation for the org-admin area, one item per shipped SPEC section. The
 * shared side-nav matches on the LONGEST href prefix, so "/org" yields to
 * "/org/content" on nested content pages without an exact-match special case.
 */
const ORG_NAV_ITEMS: readonly SideNavItem[] = [
  { href: "/org", label: "Dashboard", icon: LayoutDashboard },
  { href: "/org/members", label: "Members", icon: Users },
  { href: "/org/assignments", label: "Assignments", icon: ClipboardList },
  { href: "/org/content", label: "Content", icon: ListChecks },
  { href: "/org/billing", label: "Billing", icon: CreditCard },
  { href: "/org/audit", label: "Audit", icon: History },
  { href: "/org/settings", label: "Settings", icon: Settings },
];

/** Desktop rail for the org-admin area. */
export function OrgSidebar() {
  return <Sidebar items={ORG_NAV_ITEMS} />;
}

/** Hamburger + sheet for narrow screens. */
export function OrgMobileNav() {
  return <MobileNavSheet items={ORG_NAV_ITEMS} logoHref="/org" />;
}
