"use client";

import {
  BookOpen,
  Building2,
  CreditCard,
  Gauge,
  GraduationCap,
  ListChecks,
  Mail,
  MessagesSquare,
  Receipt,
  Stethoscope,
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
  { href: "/admin/osce", label: "OSCE", icon: Stethoscope },
  { href: "/admin/tutor/feedback", label: "Tutor", icon: MessagesSquare },
  { href: "/admin/exams", label: "Exams", icon: GraduationCap },
  { href: "/admin/courses", label: "CME", icon: BookOpen },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/orgs", label: "Orgs", icon: Building2 },
  { href: "/admin/plans", label: "Plans", icon: CreditCard },
  { href: "/admin/payments", label: "Payments", icon: Receipt },
  { href: "/admin/messages", label: "Messages", icon: Mail },
];

/**
 * Ops-attention counts from the layout (unclaimed payments + webhook
 * backlog). A count on the nav is visible from any admin page; known
 * limitation, noted in the layout: layouts do not re-render on soft
 * navigation, so the badge refreshes on hard loads and section changes.
 */
export type AdminNavBadges = {
  payments?: number;
  /** Open question-report rollups (questions, not reports). Its own badge,
   * kept apart from payments — money-ops has a different urgency. */
  questions?: number;
};

function withBadges(badges: AdminNavBadges | undefined): SideNavItem[] {
  return ADMIN_NAV_ITEMS.map((item) => {
    if (item.href === "/admin/payments") return { ...item, badge: badges?.payments };
    if (item.href === "/admin/questions") return { ...item, badge: badges?.questions };
    return item;
  });
}

export function AdminSidebar({ badges }: { badges?: AdminNavBadges }) {
  return <Sidebar items={withBadges(badges)} />;
}

export function AdminMobileNav({ badges }: { badges?: AdminNavBadges }) {
  return <MobileNavSheet items={withBadges(badges)} logoHref="/admin" />;
}
