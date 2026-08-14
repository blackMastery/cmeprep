"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Horizontal tabs for the org-admin area. Grows a tab per shipped SPEC
 * section (dashboard, assignments, content, audit, settings).
 */
const TABS: readonly { href: string; label: string }[] = [
  { href: "/org", label: "Dashboard" },
  { href: "/org/members", label: "Members" },
  { href: "/org/assignments", label: "Assignments" },
  { href: "/org/content", label: "Content" },
  { href: "/org/billing", label: "Billing" },
  { href: "/org/audit", label: "Audit" },
  { href: "/org/settings", label: "Settings" },
];

export function OrgNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Organisation"
      className="flex gap-1 overflow-x-auto border-b border-border"
    >
      {TABS.map((tab) => {
        // "/org" would prefix-match every tab; it alone is exact.
        const active =
          tab.href === "/org"
            ? pathname === "/org"
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
