"use client";

import { FileUp, FolderTree, Gauge, ListChecks } from "lucide-react";
import {
  MobileNavSheet,
  Sidebar,
  type SideNavItem,
} from "@/components/side-nav";

/**
 * Overlapping hrefs are fine: SideNavLinks highlights the longest match, so
 * /admin/questions/import lights "Import", not "Questions" or "Overview".
 */
const ADMIN_NAV_ITEMS: readonly SideNavItem[] = [
  { href: "/admin", label: "Overview", icon: Gauge },
  { href: "/admin/questions", label: "Questions", icon: ListChecks },
  { href: "/admin/questions/import", label: "Import", icon: FileUp },
  { href: "/admin/subjects", label: "Subjects & topics", icon: FolderTree },
];

export function AdminSidebar() {
  return <Sidebar items={ADMIN_NAV_ITEMS} />;
}

export function AdminMobileNav() {
  return <MobileNavSheet items={ADMIN_NAV_ITEMS} logoHref="/admin" />;
}
