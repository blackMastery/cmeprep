import type { SocialPlatform } from "@/lib/site";

/**
 * Brand marks for the social links.
 *
 * Hand-written because lucide-react dropped its brand icons in v1 — these are
 * the same 24×24 stroke outlines it used to ship, so they sit correctly
 * alongside the rest of the icon set instead of reading as pasted-in logos.
 */

type IconProps = React.ComponentProps<"svg">;

function base(props: IconProps) {
  return {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

function InstagramIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

function FacebookIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

function WhatsAppIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* Speech bubble with the tail bottom-left. */}
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.38 8.38 0 0 1-4-1L3 21l2-5.5a8.38 8.38 0 0 1-1-4 8.38 8.38 0 0 1 8.5-8.5A8.38 8.38 0 0 1 21 11.5z" />
      {/* Lucide's own Phone glyph, scaled into the bubble rather than redrawn
          by hand — a bespoke handset came out lumpy at 20px. strokeWidth is
          pre-divided by the scale so the line weight still matches the bubble
          and the rest of the icon set. */}
      <g transform="translate(7.6 7.1) scale(0.38)" strokeWidth={2 / 0.38}>
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      </g>
    </svg>
  );
}

export const SOCIAL_ICON: Record<
  SocialPlatform,
  (props: IconProps) => React.ReactElement
> = {
  instagram: InstagramIcon,
  facebook: FacebookIcon,
  whatsapp: WhatsAppIcon,
};
