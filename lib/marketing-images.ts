/**
 * Hero photography.
 *
 * Sourced from Unsplash and served from their CDN (allow-listed in
 * next.config.ts). The Unsplash License permits commercial use without
 * attribution, but it does NOT grant model or property releases — these
 * shots may not be used in a way that implies the people in them endorse
 * cmeprep.me. Crediting the photographer is optional but appreciated.
 *
 * To swap the hero, change HERO_IMAGE to another entry.
 */

export type MarketingImage = {
  /** Unsplash CDN base — query params are added at render time. */
  src: string;
  alt: string;
  credit: { photographer: string; url: string };
  /** object-position, for keeping faces out of the text column. */
  position: string;
};

export const HERO_IMAGES = {
  studentsCollaborating: {
    src: "https://images.unsplash.com/photo-1758270705518-b61b40527e76",
    alt: "A group of students studying together around a laptop",
    credit: {
      photographer: "Vitaly Gariev",
      url: "https://unsplash.com/photos/diverse-group-of-students-collaborating-around-a-laptop--X4Qx4_4iMU",
    },
    position: "center 30%",
  },
  studentsLaptop: {
    src: "https://images.unsplash.com/photo-1758270705290-62b6294dd044",
    alt: "Students gathered around a laptop in a study session",
    credit: {
      photographer: "Vitaly Gariev",
      url: "https://unsplash.com/photos/diverse-group-of-students-gathered-around-laptop-kp7qkHTgSKc",
    },
    position: "center 35%",
  },
  anatomyModel: {
    src: "https://images.unsplash.com/photo-1731357266501-fc8594f84707",
    alt: "Two students examining an anatomical skeleton model",
    credit: {
      photographer: "Lucia Navarrete",
      url: "https://unsplash.com/photos/a-man-and-a-woman-looking-at-a-model-of-a-skeleton-y3tR4_mn6es",
    },
    position: "center 40%",
  },
  suturingPractice: {
    src: "https://images.unsplash.com/photo-1767023469101-d923c6c7e9c6",
    alt: "Clinician practising suturing technique with instruments",
    credit: {
      photographer: "Jon Jezreel Andres",
      url: "https://unsplash.com/photos/woman-with-gloves-practices-suturing-with-tools-Nlcx9P-TbHI",
    },
    position: "center 45%",
  },
} as const satisfies Record<string, MarketingImage>;

export const HERO_IMAGE: MarketingImage = HERO_IMAGES.studentsCollaborating;

/** Build a sized Unsplash URL. `auto=format` serves AVIF/WebP where supported. */
export function unsplashUrl(src: string, width: number, quality = 80): string {
  return `${src}?auto=format&fit=crop&w=${width}&q=${quality}`;
}
