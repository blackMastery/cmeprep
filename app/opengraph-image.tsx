import {
  OG_CONTENT_TYPE,
  OG_SIZE,
  renderOgImage,
} from "@/lib/og-image";
import { SITE_DESCRIPTION, SITE_TAGLINE } from "@/lib/site";

export const alt = `cmeprep.me — ${SITE_TAGLINE}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** Site-wide social card; deeper routes can override with their own file. */
export default function OpengraphImage() {
  return renderOgImage({
    title: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
  });
}
