"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export type SideNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/**
 * Route matching: an item matches on its exact path or any sub-path, and the
 * LONGEST matching href wins, so "/admin" yields to "/admin/questions" which
 * yields to "/admin/questions/import" — overlapping items need no flags.
 */
function activeHref(items: readonly SideNavItem[], pathname: string) {
  return items
    .filter(
      (i) => pathname === i.href || pathname.startsWith(`${i.href}/`)
    )
    .reduce<string | null>(
      (best, i) => (best === null || i.href.length > best.length ? i.href : best),
      null
    );
}

export function SideNavLinks({
  items,
  onNavigate,
}: {
  items: readonly SideNavItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const current = activeHref(items, pathname);

  return (
    <>
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === current;
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                : "font-medium text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </>
  );
}

/**
 * Desktop rail: md and up, pinned under the sticky h-16 header. Below md the
 * matching MobileNavSheet takes over.
 */
export function Sidebar({
  items,
  footer,
}: {
  items: readonly SideNavItem[];
  footer?: React.ReactNode;
}) {
  return (
    <aside className="sticky top-16 hidden h-[calc(100svh-4rem)] w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <nav
        aria-label="Main"
        className="flex flex-1 flex-col gap-1 overflow-y-auto p-3"
      >
        <SideNavLinks items={items} />
      </nav>
      {footer}
    </aside>
  );
}

/** Hamburger + left sheet for narrow screens; closes itself on navigation. */
export function MobileNavSheet({
  items,
  logoHref,
  footer,
}: {
  items: readonly SideNavItem[];
  logoHref: string;
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Open navigation"
        >
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-64 gap-0 bg-sidebar p-0 text-sidebar-foreground"
      >
        <SheetHeader className="border-b border-sidebar-border px-4 py-3">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Links to the main areas of cmeprep.me.
          </SheetDescription>
          <span onClickCapture={close}>
            <Logo href={logoHref} size="sm" />
          </span>
        </SheetHeader>
        <nav
          aria-label="Main"
          className="flex flex-1 flex-col gap-1 overflow-y-auto p-3"
        >
          <SideNavLinks items={items} onNavigate={close} />
        </nav>
        {footer}
      </SheetContent>
    </Sheet>
  );
}
