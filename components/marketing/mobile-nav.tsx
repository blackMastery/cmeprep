"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const NAV_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#tutor", label: "AI tutor" },
  { href: "/#examinations", label: "Examinations" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/teams", label: "Enterprise & Teams" },
  { href: "/about", label: "About" },
] as const;

/** Hamburger + left sheet for public pages on narrow screens. */
export function MarketingMobileNav({
  loggedIn = false,
}: {
  loggedIn?: boolean;
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
      <SheetContent side="left" className="w-72 gap-0 p-0">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Links to the main areas of cmeqbank.com.
          </SheetDescription>
          <span onClickCapture={close}>
            <Logo href="/" size="sm" />
          </span>
        </SheetHeader>
        <nav aria-label="Main" className="flex flex-col gap-1 p-3">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={close}
              className="rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              {label}
            </Link>
          ))}
        </nav>
        <SheetFooter className="mt-auto border-t border-border p-4">
          {loggedIn ? (
            <Button className="w-full" asChild>
              <Link href="/dashboard" onClick={close}>
                Dashboard
              </Link>
            </Button>
          ) : (
            <div className="flex w-full flex-col gap-2">
              <Button variant="outline" className="w-full" asChild>
                <Link href="/login" onClick={close}>
                  Log in
                </Link>
              </Button>
              <Button className="w-full" asChild>
                <Link href="/register" onClick={close}>
                  Start free
                </Link>
              </Button>
            </div>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
