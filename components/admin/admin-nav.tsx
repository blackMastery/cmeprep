"use client";

import {
  CreditCard,
  Gauge,
  GraduationCap,
  ListChecks,
  Mail,
  Users,
} from "lucide-react";
import {
  MobileNavSheet,
  Sidebar,
  type SideNavItem,
} from "@/components/side-nav";

const ADMIN_NAV_ITEMS: readonly SideNavItem[] = [
  { href: "/admin", label: "Overview", icon: Gauge },
  { href: "/admin/questions", label: "Questions", icon: ListChecks },
  { href: "/admin/exams", label: "Exams", icon: GraduationCap },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/plans", label: "Plans", icon: CreditCard },
  { href: "/admin/messages", label: "Messages", icon: Mail },
];

export function AdminSidebar() {
  return <Sidebar items={ADMIN_NAV_ITEMS} />;
}

export function AdminMobileNav() {
  return <MobileNavSheet items={ADMIN_NAV_ITEMS} logoHref="/admin" />;
}
