import type { SessionUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/format";
import { AccountMenu } from "@/components/app/account-menu";
import { MobileNav } from "@/components/app/app-nav";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/app/theme-toggle";

export function AppHeader({
  user,
  orgAdmin = false,
  orgMember = false,
  orgBrand = null,
}: {
  user: SessionUser;
  orgAdmin?: boolean;
  orgMember?: boolean;
  /** Member's org branding — shown ALONGSIDE the CMEPrep brand (SPEC §9). */
  orgBrand?: { name: string; logoUrl: string | null } | null;
}) {
  const { profile } = user;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="flex h-(--app-header-h) w-full items-center gap-2 px-4 sm:gap-4">
        <MobileNav user={user} orgAdmin={orgAdmin} orgMember={orgMember} />
        <Logo
          href="/dashboard"
          tagline="inline"
          /* The banner image already says "smarter prep"; the 7px text line
             under it just crowded the 64px bar next to the menu button. */
          taglineClassName="max-sm:hidden"
        />
        {orgBrand && (
          <span className="hidden min-w-0 items-center gap-2 border-l border-border pl-3 sm:flex">
            {orgBrand.logoUrl && (
              // Tiny, arbitrary-aspect asset — the optimizer adds nothing.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={orgBrand.logoUrl}
                alt=""
                className="h-6 w-auto max-w-24 object-contain"
              />
            )}
            <span className="truncate text-sm font-medium text-muted-foreground">
              {orgBrand.name}
            </span>
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Badge
            variant={profile.role === "trial" ? "secondary" : "default"}
            className="hidden sm:inline-flex"
          >
            {ROLE_LABEL[profile.role] ?? profile.role}
          </Badge>

          <ThemeToggle />
          <AccountMenu user={user} />
        </div>
      </div>
    </header>
  );
}
