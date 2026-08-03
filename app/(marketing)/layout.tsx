import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { MarketingMobileNav } from "@/components/marketing/mobile-nav";
import { SocialLinks } from "@/components/marketing/social-links";
import { WHATSAPP_DISPLAY, WHATSAPP_HREF } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 md:gap-6">
          <MarketingMobileNav loggedIn={Boolean(user)} />
          <Logo
            tagline="inline"
            taglineClassName="max-md:hidden"
          />
          <nav className="ml-auto hidden items-center gap-1 md:flex">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/#features">Features</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/#examinations">Examinations</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/#pricing">Pricing</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/teams">Enterprise &amp; Teams</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/about">About</Link>
            </Button>
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            {user ? (
              <Button size="sm" asChild>
                <Link href="/dashboard">Dashboard</Link>
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden md:inline-flex"
                  asChild
                >
                  <Link href="/login">Log in</Link>
                </Button>
                <Button size="sm" asChild>
                  <Link href="/register">Start free</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="bg-ink text-[#d8d4cd]">
        <div className="mx-auto w-full max-w-6xl px-4 py-12">
          <div className="flex flex-wrap items-start justify-between gap-8">
            <div className="max-w-xs">
              <Logo
                href={null}
                tagline="stacked"
                taglineClassName="text-[#a9a29b]"
              />
              <p className="mt-4 text-sm text-[#a9a29b]">
                Practice questions and timed mock exams for medical board and
                exit examinations.
              </p>
              <SocialLinks
                className="mt-4 -ml-2"
                linkClassName="text-[#a9a29b] hover:bg-white/10 hover:text-white"
              />
            </div>
            <div className="flex gap-12 text-sm">
              <div className="space-y-2">
                <p className="font-medium text-white">Product</p>
                <Link href="/#pricing" className="block text-[#a9a29b] hover:text-white">
                  Pricing
                </Link>
                <Link href="/teams" className="block text-[#a9a29b] hover:text-white">
                  Teams &amp; Enterprises
                </Link>
                <Link href="/about" className="block text-[#a9a29b] hover:text-white">
                  About
                </Link>
                <Link href="/register" className="block text-[#a9a29b] hover:text-white">
                  Start free
                </Link>
              </div>
              <div className="space-y-2">
                <p className="font-medium text-white">Support</p>
                <Link
                  href="/about#contact"
                  className="block text-[#a9a29b] hover:text-white"
                >
                  Contact
                </Link>
                <a
                  href={WHATSAPP_HREF}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-[#a9a29b] hover:text-white"
                >
                  WhatsApp {WHATSAPP_DISPLAY}
                </a>
                <Link
                  href="/privacy"
                  className="block text-[#a9a29b] hover:text-white"
                >
                  Privacy
                </Link>
              </div>
            </div>
          </div>
          <p className="mt-10 border-t border-white/10 pt-6 text-xs text-[#6f6a72]">
            © {new Date().getFullYear()} cmeprep.me
          </p>
        </div>
      </footer>
    </div>
  );
}
