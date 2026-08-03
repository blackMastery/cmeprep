import { activeSocialLinks } from "@/lib/site";
import { SOCIAL_ICON } from "@/components/brand/social-icons";
import { cn } from "@/lib/utils";

/**
 * Icon row for the social profiles.
 *
 * Renders nothing when no profile has a URL yet, so dropping it into a layout
 * ahead of the accounts existing is safe — see SOCIAL_LINKS in lib/site.ts.
 */
export function SocialLinks({
  className,
  linkClassName,
  label = "Follow us",
}: {
  className?: string;
  /** Colours differ between the dark footer and the light About card. */
  linkClassName?: string;
  /** Accessible name for the group. */
  label?: string;
}) {
  const links = activeSocialLinks();
  if (links.length === 0) return null;

  return (
    <ul
      aria-label={label}
      className={cn("flex items-center gap-1", className)}
    >
      {links.map(({ platform, label: name, href }) => {
        const Icon = SOCIAL_ICON[platform];
        return (
          <li key={platform}>
            <a
              href={href}
              target="_blank"
              // noreferrer alongside noopener: the tab-napping fix is the
              // former, and referrer leakage is worth closing on a link we
              // don't control the far end of.
              rel="noopener noreferrer"
              aria-label={`${name} (opens in a new tab)`}
              className={cn(
                "flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-foreground/10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                linkClassName
              )}
            >
              <Icon className="size-5" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
