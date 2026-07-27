import {
  OG_CONTENT_TYPE,
  OG_SIZE,
  renderOgImage,
} from "@/lib/og-image";
import { SITE_DESCRIPTION, SITE_TAGLINE } from "@/lib/site";

export const alt = `cmeprep.me — ${SITE_TAGLINE}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/**
 * Same artwork as the OG card. It exists as its own file because `twitter:`
 * tags do not inherit the opengraph-image convention — without this, X and
 * several other summary_large_image consumers render no image at all.
 */
export default function TwitterImage() {
  return renderOgImage({
    title: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
  });
}
